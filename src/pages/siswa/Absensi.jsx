// src/pages/siswa/SAbsensi.jsx
import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { Camera, CheckCircle2, Loader2, QrCode, ScanLine, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import ProfileAvatar from '../../components/ProfileAvatar'

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

const extractQrToken = (rawValue = '') => {
  const value = String(rawValue || '').trim()
  if (!value) return ''

  try {
    const url = new URL(value)
    return (
      url.searchParams.get('qr') ||
      url.searchParams.get('token') ||
      url.searchParams.get('attendance_qr') ||
      value
    )
  } catch {
    const match = value.match(/(?:^|[?&])(qr|token|attendance_qr)=([^&#]+)/)
    if (match?.[2]) {
      try {
        return decodeURIComponent(match[2])
      } catch {
        return match[2]
      }
    }
    return value
  }
}

const QrSuccessOverlay = ({ data, onClose }) => {
  if (!data) return null

  const detailRows = [
    ['Nama', data.nama],
    ['Mata Pelajaran', data.mapel],
    ['Guru', data.guru],
    ['Jam Absensi', data.jam_absensi],
    ['Hari', data.hari],
    ['Tanggal', data.tanggal],
    ['Bulan', data.bulan],
    ['Tahun', data.tahun]
  ]

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/55 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white border border-emerald-100 shadow-2xl overflow-hidden animate-[qr-success-pop_220ms_ease-out]">
        <div className="px-6 pt-7 pb-5 text-center bg-gradient-to-b from-emerald-50 to-white">
          <div className="mx-auto h-20 w-20 rounded-full bg-emerald-100 text-emerald-600 grid place-items-center animate-[qr-check-pulse_900ms_ease-out]">
            <CheckCircle2 className="h-12 w-12" strokeWidth={2.4} />
          </div>
          <h2 className="mt-4 text-xl font-bold text-slate-900">Absensi Berhasil</h2>
          <p className="mt-1 text-sm text-slate-600">Kehadiran kamu sudah tercatat.</p>
        </div>

        <div className="px-6 pb-5 space-y-2">
          {detailRows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
              <span className="text-sm font-bold text-slate-900 text-right">{value || '-'}</span>
            </div>
          ))}
        </div>

        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 transition-colors"
          >
            Selesai
          </button>
        </div>
      </div>
      <style>{`
        @keyframes qr-success-pop {
          from { opacity: 0; transform: translateY(10px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes qr-check-pulse {
          0% { transform: scale(0.72); opacity: 0; }
          55% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

const QrScannerPanel = ({ onSubmitToken, isSubmitting, lastError }) => {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const frameRef = useRef(0)
  const processingRef = useRef(false)
  const [cameraState, setCameraState] = useState('idle')
  const [cameraError, setCameraError] = useState('')
  const [manualToken, setManualToken] = useState('')

  const stopCamera = useCallback((updateState = true) => {
    try {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current)
      }
      streamRef.current?.getTracks?.().forEach((track) => track.stop())
    } catch {
      // ignore camera stop errors
    }
    frameRef.current = 0
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    if (updateState) {
      setCameraState((prev) => (prev === 'active' || prev === 'starting' ? 'idle' : prev))
    }
  }, [])

  const submitDecodedValue = useCallback(
    async (value) => {
      if (processingRef.current) return
      const token = extractQrToken(value)
      if (!token) {
        setCameraError('QR tidak berisi token absensi yang valid.')
        return
      }

      processingRef.current = true
      stopCamera()
      await onSubmitToken(token)
      window.setTimeout(() => {
        processingRef.current = false
      }, 1200)
    },
    [onSubmitToken, stopCamera]
  )

  const scanFrame = useCallback(
    async (detector) => {
      if (processingRef.current) return
      const video = videoRef.current
      if (!video) return

      try {
        if (video.readyState >= 2) {
          const codes = await detector.detect(video)
          const rawValue = codes?.[0]?.rawValue
          if (rawValue) {
            await submitDecodedValue(rawValue)
            return
          }
        }
      } catch {
        // frame tertentu bisa gagal diproses; lanjutkan scan frame berikutnya
      }

      frameRef.current = window.requestAnimationFrame(() => {
        void scanFrame(detector)
      })
    },
    [submitDecodedValue]
  )

  const startCamera = useCallback(async () => {
    if (cameraState === 'starting' || cameraState === 'active') return
    setCameraError('')
    setCameraState('starting')

    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Browser belum mendukung akses kamera.')
      }
      if (typeof window === 'undefined' || typeof window.BarcodeDetector !== 'function') {
        throw new Error('Browser belum mendukung scanner QR otomatis. Gunakan Chrome/Edge terbaru atau tempel kode QR.')
      }

      const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' }
        },
        audio: false
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraState('active')
      frameRef.current = window.requestAnimationFrame(() => {
        void scanFrame(detector)
      })
    } catch (err) {
      try {
        streamRef.current?.getTracks?.().forEach((track) => track.stop())
      } catch {
        // ignore cleanup errors
      }
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
      setCameraState('error')
      setCameraError(err?.message || 'Tidak bisa membuka kamera.')
    }
  }, [cameraState, scanFrame])

  useEffect(() => () => stopCamera(false), [stopCamera])

  const handleManualSubmit = async (event) => {
    event.preventDefault()
    await submitDecodedValue(manualToken)
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr),minmax(320px,0.8fr)] gap-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-950 overflow-hidden shadow-sm">
        <div className="relative aspect-[4/3] bg-slate-950">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          {cameraState !== 'active' && (
            <div className="absolute inset-0 grid place-items-center bg-slate-950">
              <div className="text-center px-6">
                <div className="mx-auto h-16 w-16 rounded-2xl bg-white/10 text-white grid place-items-center mb-4">
                  <ScanLine className="h-9 w-9" />
                </div>
                <div className="text-white font-bold">Kamera scanner QR</div>
                <div className="text-slate-300 text-sm mt-1">Arahkan kamera ke QR yang tampil di layar guru.</div>
              </div>
            </div>
          )}
          {cameraState === 'active' && (
            <div className="absolute inset-0 pointer-events-none grid place-items-center">
              <div className="h-48 w-48 rounded-2xl border-4 border-emerald-400 shadow-[0_0_0_9999px_rgba(2,6,23,0.38)]" />
            </div>
          )}
        </div>

        <div className="bg-white p-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={startCamera}
            disabled={isSubmitting || cameraState === 'starting' || cameraState === 'active'}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-bold text-white"
          >
            {cameraState === 'starting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {cameraState === 'starting' ? 'Membuka kamera' : 'Mulai Scan'}
          </button>
          <button
            type="button"
            onClick={() => stopCamera()}
            disabled={cameraState !== 'active'}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-bold text-slate-700"
          >
            <XCircle className="h-4 w-4" />
            Stop
          </button>
          <div className="ml-auto text-xs font-semibold text-slate-500">
            {cameraState === 'active' ? 'Scanner aktif' : 'Scanner standby'}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 grid place-items-center">
            <QrCode className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900">Scan QR dari guru</h3>
            <p className="text-xs text-slate-500">Sistem akan validasi kelas, sekolah, jadwal, dan jam pelajaran.</p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          QR akan otomatis ditolak jika sudah lewat jam pelajaran, token kedaluwarsa, atau bukan untuk sekolah dan kelas kamu.
        </div>

        {(cameraError || lastError) && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {cameraError || lastError}
          </div>
        )}

        <form onSubmit={handleManualSubmit} className="mt-5 space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
            Tempel kode QR jika kamera tidak tersedia
          </label>
          <textarea
            value={manualToken}
            onChange={(event) => setManualToken(event.target.value)}
            rows={4}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Tempel hasil scan QR di sini"
          />
          <button
            type="submit"
            disabled={isSubmitting || !manualToken.trim()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed px-4 py-3 text-sm font-bold text-white"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Proses Absensi QR
          </button>
        </form>
      </div>
    </div>
  )
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
    <div className="bg-gradient-to-r from-white to-blue-50 border border-blue-100 rounded-2xl px-4 py-3 shadow-sm">
      <div className="text-center">
        <div className="text-[11px] uppercase tracking-wide text-blue-600 font-semibold mb-1">Waktu Real-time</div>
        <div className="text-base font-semibold font-mono text-slate-800">
          {currentTime.toLocaleTimeString('id-ID')}
        </div>
        <div className="text-xs text-slate-600 mt-1">
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
    default: 'bg-slate-100 text-slate-800 border border-slate-200',
    hadir: 'bg-green-100 text-green-800 border border-green-300',
    izin: 'bg-yellow-100 text-yellow-800 border border-yellow-300',
    sakit: 'bg-blue-100 text-blue-800 border border-blue-300', // 🟦 baru
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
const RingkasanKelasTable = ({
  kelas,
  mapel,
  tanggal,
  selfUserId,
  canClickHadir,
  canClickIzin,
  izinDisabledReason,
  onHadir,
  onIzin
}) => {
  const [dataSiswa, setDataSiswa] = useState([])
  const [isLoading, setIsLoading] = useState(false)

  const loadDataSiswa = useCallback(async () => {
    if (!kelas || !tanggal) {
      setDataSiswa([])
      return
    }

    setIsLoading(true)
    try {
      let siswaData = []
      let siswaError = null

        ; ({ data: siswaData, error: siswaError } = await supabase
          .from('profiles')
          .select('id, nama, photo_url, photo_path, nis, kelas')
          .eq('role', 'siswa')
          .eq('kelas', kelas)
          .order('nama'))

      if (siswaError && /photo_path/i.test(siswaError.message || '')) {
        ; ({ data: siswaData, error: siswaError } = await supabase
          .from('profiles')
          .select('id, nama, photo_url, nis, kelas')
          .eq('role', 'siswa')
          .eq('kelas', kelas)
          .order('nama'))
      }

      if (siswaError) throw siswaError

      let absensiData = []
      if (mapel) {
        const { data, error: absensiError } = await supabase
          .from('absensi')
          .select('uid, status, komentar, oleh, waktu, nama')
          .eq('kelas', kelas)
          .eq('mapel', mapel)
          .eq('tanggal', tanggal)

        if (absensiError) throw absensiError
        absensiData = data || []
      }

      const absensiByUid = new Map((absensiData || []).map((a) => [a.uid, a]))
      const mapped = (siswaData || []).map((s) => {
        const absen = absensiByUid.get(s.id)
        return {
          id: s.id,
          nama: s.nama || absen?.nama || 'Tanpa Nama',
          foto: s.photo_path || s.photo_url || null,
          nis: s.nis || null,
          kelas: s.kelas || kelas,
          status: absen?.status || null,
          komentar: absen?.komentar || '',
          oleh: absen?.oleh || '',
          waktu: absen?.waktu || ''
        }
      })

      const existingIds = new Set(mapped.map((s) => s.id))
        ; (absensiData || []).forEach((abs) => {
          if (!existingIds.has(abs.uid)) {
            mapped.push({
              id: abs.uid,
              nama: abs.nama || 'Tanpa Nama',
              foto: null,
              nis: null,
              kelas,
              status: abs.status || null,
              komentar: abs.komentar || '',
              oleh: abs.oleh || '',
              waktu: abs.waktu || ''
            })
          }
        })

      mapped.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''))
      setDataSiswa(mapped)
    } catch (error) {
      console.error('Error loading data siswa:', error)
    } finally {
      setIsLoading(false)
    }
  }, [kelas, mapel, tanggal])

  useEffect(() => {
    loadDataSiswa()
  }, [loadDataSiswa])

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
        return 'bg-green-50/70 hover:bg-green-50'
      case 'Izin':
        return 'bg-yellow-50/70 hover:bg-yellow-50'
      case 'Sakit':
        return 'bg-blue-50/70 hover:bg-blue-50'
      case 'Alpha':
        return 'bg-red-50/70 hover:bg-red-50'
      default:
        return 'bg-white hover:bg-slate-50'
    }
  }

  const getStatusBadgeClass = (status) => {
    if (!mapel) return 'bg-slate-100 text-slate-700 border border-slate-200'
    switch (status) {
      case 'Hadir':
        return 'bg-green-100 text-green-800 border border-green-200'
      case 'Izin':
        return 'bg-yellow-100 text-yellow-800 border border-yellow-200'
      case 'Sakit':
        return 'bg-blue-100 text-blue-800 border border-blue-200'
      case 'Alpha':
        return 'bg-red-100 text-red-800 border border-red-200'
      default:
        return 'bg-slate-100 text-slate-700 border border-slate-200'
    }
  }

  const getDetailAbsensi = (siswa) => {
    if (!mapel) return 'Pilih mapel terlebih dahulu'
    if (!siswa.status) return 'Belum ada absensi'
    if (siswa.status !== 'Hadir') return siswa.komentar || siswa.status
    if ((siswa.komentar || '').includes('RFID') || siswa.oleh === 'rfid') return 'Via RFID'
    if ((siswa.komentar || '').includes('mandiri') || siswa.oleh === 'siswa') return 'Absen Mandiri'
    if (siswa.oleh === 'guru') return 'Diabsen Guru'
    if (siswa.oleh === 'system') return 'Auto System'
    return siswa.komentar || 'Hadir'
  }

  const getJamStatus = (waktu) => {
    if (!waktu) return '-'
    const parsed = new Date(waktu)
    if (Number.isNaN(parsed.getTime())) return '-'
    return parsed.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  }

  if (isLoading) {
    return (
      <div className="text-center py-6">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-slate-600 text-xs">Memuat daftar siswa...</p>
      </div>
    )
  }

  if (!dataSiswa.length) {
    return (
      <div className="text-xs text-slate-500 italic">
        Belum ada data siswa untuk kelas ini.
      </div>
    )
  }

  return (
    <div className="mt-3">
      <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50/90 border-b border-slate-200">
              <th className="text-left px-3 py-2.5 font-semibold text-slate-700 w-12">No</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-700">Siswa</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-700">NIS</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-700">Status</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-700">Jam</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-700">Detail</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-700">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {dataSiswa.map((siswa, idx) => {
              const isSelf = siswa.id === selfUserId
              const hasStatus = !!siswa.status

              return (
                <tr
                  key={siswa.id}
                  className={`border-b border-slate-100 transition-colors ${getStatusColor(
                    siswa.status
                  )} ${isSelf ? 'ring-1 ring-inset ring-blue-200' : ''}`}
                >
                  <td className="px-3 py-2.5 text-slate-600 font-medium">{idx + 1}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center space-x-2">
                      <ProfileAvatar
                        src={siswa.foto}
                        name={siswa.nama}
                        size={30}
                        className="border-slate-300"
                      />
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 text-xs">
                          {siswa.nama}
                        </span>
                        {isSelf && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-blue-100 text-blue-700 border border-blue-200 font-semibold">
                            Anda
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 text-[11px]">
                    {siswa.nis || '-'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full font-semibold text-[11px] ${getStatusBadgeClass(
                        siswa.status
                      )}`}
                    >
                      {!mapel ? 'Pilih Mapel' : siswa.status || 'Belum Absen'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] font-semibold text-slate-700">
                    {siswa.status === 'Hadir' ? getJamStatus(siswa.waktu) : '-'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[11px] text-slate-700 leading-relaxed">
                      {getDetailAbsensi(siswa)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {isSelf ? (
                      hasStatus ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                          Selesai
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={onHadir}
                            disabled={!canClickHadir}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${!canClickHadir
                              ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                              : 'bg-green-600 hover:bg-green-700 text-white'
                              }`}
                          >
                            Hadir
                          </button>
                          <button
                            type="button"
                            onClick={onIzin}
                            disabled={!canClickIzin}
                            title={
                              canClickIzin
                                ? 'Ajukan izin'
                                : izinDisabledReason || 'Ajukan izin tidak tersedia'
                            }
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${!canClickIzin
                              ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                              : 'bg-yellow-500 hover:bg-yellow-600 text-white'
                              }`}
                          >
                            Ajukan Izin
                          </button>
                        </div>
                      )
                    ) : (
                      <span className="text-[11px] text-slate-400">-</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">
        Menampilkan {dataSiswa.length} siswa. Baris akun Anda diberi label <span className="font-semibold">Anda</span>.
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
      return 'border-green-400 bg-green-50'
    }
    if (isCurrent) return 'border-blue-400 bg-blue-50'
    if (jadwal.status) return 'border-blue-300 bg-blue-50'
    return 'border-slate-200 bg-white'
  }

  const isSesiAktifFlag = isSesiAktif()

  return (
    <div className={`rounded-2xl border p-4 transition-all duration-200 shadow-sm hover:shadow-md ${getCardStyle()}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center space-x-2">
          <div
            className={`w-2 h-2 rounded-full ${isCurrent && isSesiAktifFlag && jadwal.mode === 'otomatis' && !jadwal.status
              ? 'bg-green-500 animate-pulse'
              : isCurrent
                ? 'bg-blue-500'
                : jadwal.status
                  ? 'bg-blue-400'
                  : 'bg-slate-400'
              }`}
          />
          <div>
            <h3 className="font-semibold text-slate-900 text-sm">{jadwal.mapel}</h3>
            <p className="text-xs text-slate-600">{jadwal.guru_nama || 'Guru'}</p>
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
        <div className="text-center p-2 bg-white rounded-xl border border-slate-200">
          <div className="text-[11px] text-slate-600">Mulai</div>
          <div className="font-semibold text-slate-900 text-sm">
            {jadwal.jam_mulai}
          </div>
        </div>
        <div className="text-center p-2 bg-white rounded-xl border border-slate-200">
          <div className="text-[11px] text-slate-600">Selesai</div>
          <div className="font-semibold text-slate-900 text-sm">
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
                : jadwal.status === 'Izin'
                  ? 'izin'
                  : jadwal.status === 'Sakit'
                    ? 'sakit'
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
            className="w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold transition-all duration-200 text-[11px]"
            onClick={() => onAbsenClick(jadwal)}
          >
            Absen
          </button>
        )}
        <button
          className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all duration-200 text-[11px]"
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
        ; (data || []).forEach((item) => {
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
      let textColor = 'text-slate-900'
      let borderColor = 'border-slate-200'

      if (hasJadwal) {
        if (status === 'Hadir') {
          bgColor = 'bg-green-100'
          borderColor = 'border-green-300'
          textColor = 'text-green-900'
        } else if (status === 'Alpha') {
          bgColor = 'bg-red-100'
          borderColor = 'border-red-300'
          textColor = 'text-red-900'
        } else if (status === 'Izin') {
          bgColor = 'bg-yellow-100'
          borderColor = 'border-yellow-300'
          textColor = 'text-yellow-900'
        } else if (status === 'Sakit') {
          bgColor = 'bg-blue-100'
          borderColor = 'border-blue-300'
          textColor = 'text-blue-900'
        } else {
          bgColor = 'bg-yellow-100'
          borderColor = 'border-yellow-300'
          textColor = 'text-yellow-900'
        }
      } else {
        bgColor = 'bg-slate-50'
        textColor = 'text-slate-500'
        borderColor = 'border-slate-100'
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-900">
            Kalender Absensi - {mapel}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 text-2xl"
          >
            ×
          </button>
        </div>

        {/* Filter Bulan */}
        <div className="mb-6">
          <div className="w-64">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Bulan
            </label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 border border-slate-300 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-green-100 border border-green-300 rounded" />
            <span className="text-xs text-slate-600">Hadir</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-yellow-100 border border-yellow-300 rounded" />
            <span className="text-xs text-slate-600">Izin</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-blue-100 border border-blue-300 rounded" />
            <span className="text-xs text-slate-600">Sakit</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-red-100 border border-red-300 rounded" />
            <span className="text-xs text-slate-600">Alpha</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-yellow-100 border border-yellow-300 rounded" />
            <span className="text-xs text-slate-600">Belum Absen</span>
          </div>
        </div>

        {/* Kalender */}
        {isLoading ? (
          <div className="text-center py-8">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-slate-600 text-sm">Memuat data absensi...</p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            {/* Header Hari */}
            <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
              {hariList.map((hari) => (
                <div
                  key={hari}
                  className="p-3 text-center text-sm font-medium text-slate-700 border-r border-slate-200 last:border-r-0"
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
                  className={`min-h-[80px] p-2 border-b border-r border-slate-200 last:border-r-0 ${day ? day.bgColor : 'bg-slate-50'
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
                              className={`text-xs px-1 py-0.5 rounded ${day.status === 'Hadir'
                                ? 'bg-green-200 text-green-800'
                                : day.status === 'Alpha'
                                  ? 'bg-red-200 text-red-800'
                                  : day.status === 'Izin'
                                    ? 'bg-yellow-200 text-yellow-800'
                                    : day.status === 'Sakit'
                                      ? 'bg-blue-200 text-blue-800'
                                      : 'bg-yellow-200 text-yellow-800'
                                }`}
                            >
                              {day.status || 'Belum Absen'}
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
            className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-2xl font-medium transition-colors"
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
          ; (data || []).forEach((d) => {
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
  const [searchParams, setSearchParams] = useSearchParams()
  const userId = profile?.id || user?.id

  // State utama
  const [currentTime, setCurrentTime] = useState(new Date())
  const [currentDateTime, setCurrentDateTime] = useState(getCurrentDateTime())

  const [tab, setTab] = useState('manual')
  const [mapel, setMapel] = useState('')
  const [tgl, setTgl] = useState(getToday())
  const [status, setStatus] = useState(null)
  const [ringkas, setRingkas] = useState({ H: 0, I: 0, S: 0, A: 0 }) // 🆕 ada S
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [jadwalHariIni, setJadwalHariIni] = useState([])
  const [jadwalMingguIni, setJadwalMingguIni] = useState({})
  const [currentJadwal, setCurrentJadwal] = useState(null)
  const [currentJadwalIndex, setCurrentJadwalIndex] = useState(-1)
  const [isAbsenOpen, setIsAbsenOpen] = useState(false)

  const [isIzinModalOpen, setIsIzinModalOpen] = useState(false)
  const [izinReason, setIzinReason] = useState('')
  const [isQrSubmitting, setIsQrSubmitting] = useState(false)
  const [qrScanError, setQrScanError] = useState('')
  const [qrSuccessData, setQrSuccessData] = useState(null)

  // Statistik kehadiran (HANYA HARI INI)
  const [statistikKehadiran, setStatistikKehadiran] = useState({
    Hadir: 0,
    Izin: 0,
    Sakit: 0,
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
  const [rfidSettingsId, setRfidSettingsId] = useState('')

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
          .order('updated_at', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (error && error.code !== 'PGRST116') {
          console.error('Error loading RFID settings:', error)
          return
        }

        if (data) {
          setRfidSettingsId(data.id || '')
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
    // If teacher explicitly opens "otomatis" mode, allow manual attendance as well
    if (currentJadwal?.mode === 'otomatis') return true

    // Otherwise, if RFID is active and in range, block manual attendance
    if (rfidSettings.rfid_aktif && isInRfidTimeRange()) return false
    return true
  }, [rfidSettings, isInRfidTimeRange, currentJadwal])

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

      const statistik = { Hadir: 0, Izin: 0, Sakit: 0, Alpha: 0 }
        ; (data || []).forEach((item) => {
          if (item.status === 'Hadir') statistik.Hadir++
          else if (item.status === 'Izin') statistik.Izin++
          else if (item.status === 'Sakit') statistik.Sakit++
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

          // Hindari maybeSingle agar tidak error jika data lama duplikat.
          const { data: absensiRows, error: absensiError } = await supabase
            .from('absensi')
            .select('status, waktu')
            .eq('kelas', profile.kelas)
            .eq('tanggal', getToday())
            .eq('mapel', jadwalItem.mapel)
            .eq('uid', userId)
            .order('waktu', { ascending: false })
            .limit(1)

          if (absensiError) {
            console.warn('Error load status absensi per mapel:', absensiError)
          }

          const absensi = (absensiRows || [])[0] || null

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

        ; (jadwalList || []).forEach((jadwal) => {
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

      const agg = { H: 0, I: 0, S: 0, A: 0 }
      let myStatus = null

        ; (data || []).forEach((row) => {
          if (row.status === 'Hadir') agg.H++
          else if (row.status === 'Izin') agg.I++
          else if (row.status === 'Sakit') agg.S++
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
      setRingkas({ H: 0, I: 0, S: 0, A: 0 })
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

  const selectedMapelJadwal = useMemo(() => {
    if (!mapel) return null
    return (jadwalHariIni || []).find((j) => j.mapel === mapel) || null
  }, [mapel, jadwalHariIni])

  const izinAvailability = useMemo(() => {
    if (!mapel) {
      return { allowed: false, reason: 'Pilih mapel terlebih dahulu' }
    }
    if (status) {
      return { allowed: false, reason: 'Anda sudah memiliki status absensi' }
    }
    if (tgl !== getToday()) {
      return {
        allowed: false,
        reason: 'Izin hanya bisa diajukan pada tanggal hari ini'
      }
    }
    if (!selectedMapelJadwal) {
      return {
        allowed: false,
        reason: 'Mapel tidak ada di jadwal hari ini'
      }
    }

    const now = currentDateTime.minutes
    const startMinutes = toMinutes(selectedMapelJadwal.jam_mulai)
    const endMinutes = toMinutes(selectedMapelJadwal.jam_selesai)

    if (now < startMinutes) {
      return { allowed: false, reason: 'Sesi absensi belum dimulai' }
    }
    if (now > endMinutes) {
      return {
        allowed: false,
        reason: 'Waktu absensi sudah habis, tidak bisa ajukan izin'
      }
    }

    return { allowed: true, reason: '' }
  }, [
    mapel,
    status,
    tgl,
    selectedMapelJadwal,
    currentDateTime.minutes
  ])

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

    if (!izinAvailability.allowed) {
      pushToast('error', izinAvailability.reason)
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

      // Check if mode is 'otomatis'
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

  const handleQrScanToken = useCallback(
    async (rawToken) => {
      const token = extractQrToken(rawToken)
      if (!token) {
        const message = 'QR tidak berisi token absensi yang valid.'
        setQrScanError(message)
        pushToast('error', message)
        return false
      }

      if (isQrSubmitting) return false

      setIsQrSubmitting(true)
      setQrScanError('')

      try {
        const { data, error, raw } = await supabase.attendanceQr.scan(token)
        if (error) {
          const message = raw?.error || error?.message || 'Gagal memproses QR absensi'
          setQrScanError(message)
          pushToast('error', message, { duration: 5000 })
          return false
        }

        const result = data || {}
        setQrSuccessData(result)
        setStatus('Hadir')
        statusRef.current = 'Hadir'
        if (result.tanggal_iso) setTgl(result.tanggal_iso)
        if (result.mapel) setMapel(result.mapel)

        const jadwalList = jadwalRef.current || []
        const matchedIndex = jadwalList.findIndex((j) => j.mapel === result.mapel)
        if (matchedIndex !== -1) {
          setCurrentJadwalIndex(matchedIndex)
          setCurrentJadwal(jadwalList[matchedIndex])
          currentJadwalRef.current = jadwalList[matchedIndex]
        }

        pushToast('success', `Absensi QR berhasil untuk ${result.mapel || 'jadwal ini'}`, {
          duration: 4500
        })

        const {
          loadRingkasDanStatus: refreshRingkas,
          loadJadwalHariIni: refreshJadwal,
          loadStatistikKehadiran: refreshStatistik
        } = refreshFnsRef.current

        if (refreshRingkas) refreshRingkas()
        if (refreshJadwal) refreshJadwal()
        if (refreshStatistik) refreshStatistik()

        return true
      } catch (err) {
        const message = err?.message || 'Terjadi kesalahan saat memproses QR absensi'
        setQrScanError(message)
        pushToast('error', message)
        return false
      } finally {
        setIsQrSubmitting(false)
      }
    },
    [isQrSubmitting, pushToast]
  )

  useEffect(() => {
    if (!profile || !userId) return

    const tokenFromUrl =
      searchParams.get('qr') ||
      searchParams.get('token') ||
      searchParams.get('attendance_qr')

    if (!tokenFromUrl) return

    setTab('qr')
    void handleQrScanToken(tokenFromUrl)

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('qr')
    nextParams.delete('token')
    nextParams.delete('attendance_qr')
    setSearchParams(nextParams, { replace: true })
  }, [profile, userId, searchParams, setSearchParams, handleQrScanToken])

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
          const row = payload.new || payload.old
          if (row && row.mapel === mapel && row.tanggal === tgl) {
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
        rfidSettingsId
          ? {
            event: '*',
            schema: 'public',
            table: 'absensi_rfid_settings',
            filter: `id=eq.${rfidSettingsId}`
          }
          : {
            event: '*',
            schema: 'public',
            table: 'absensi_rfid_settings'
          },
        (payload) => {
          if (payload.new) {
            setRfidSettingsId(payload.new.id || '')
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
  }, [rfidSettingsId])

  /* ========== Realtime RFID Scan ========== */
  useEffect(() => {
    if (!profile?.rfid_uid || !userId) return

    const cardUid = (profile.rfid_uid || '')
      .toUpperCase()
      .replace(/\s+/g, '')
    if (!cardUid) return

    const handleRfidEvent = async (payload) => {
      const scan = payload.new
      if (!scan || (scan.status && String(scan.status).toLowerCase() !== 'raw')) return
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

  const isHadirActionDisabled =
    !mapel ||
    !!status ||
    isSubmitting ||
    !isAbsenOpen ||
    currentJadwal?.mode !== 'otomatis' ||
    !isManualAbsenAllowed()

  const isIzinActionDisabled = isSubmitting || !izinAvailability.allowed

  /* ========== Loading Profile ========== */
  if (!profile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50/30 p-4 flex items-center justify-center">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center max-w-md w-full shadow-sm">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Memuat data...</p>
        </div>
      </div>
    )
  }

  /* ======================= RENDER ======================= */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50/30 p-4 sm:p-6">
      <QrSuccessOverlay data={qrSuccessData} onClose={() => setQrSuccessData(null)} />
      <div className="max-w-full mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl border border-slate-200/60 p-6 shadow-sm transition-all duration-300 hover:shadow-md">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-3 h-12 bg-gradient-to-b from-blue-500 to-purple-600 rounded-full"></div>
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-slate-900">Absensi Siswa</h1>
                <p className="text-slate-600 text-sm mt-1">
                  {profile.kelas} • {profile.nama}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Rekap Kehadiran <span className="font-semibold">Hari Ini</span>
                </p>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-3">
              {/* Statistik Kehadiran HARI INI */}
              <div className="grid grid-cols-4 gap-2 bg-slate-50 rounded-2xl p-3 border border-slate-200">
                <div className="text-center">
                  <div className="text-lg font-bold text-green-600">
                    {statistikKehadiran.Hadir}
                  </div>
                  <div className="text-xs text-slate-600 font-medium">Hadir</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-yellow-600">
                    {statistikKehadiran.Izin}
                  </div>
                  <div className="text-xs text-slate-600 font-medium">Izin</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-blue-600">
                    {statistikKehadiran.Sakit}
                  </div>
                  <div className="text-xs text-slate-600 font-medium">Sakit</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-red-600">
                    {statistikKehadiran.Alpha}
                  </div>
                  <div className="text-xs text-slate-600 font-medium">Alpha</div>
                </div>
              </div>

              {/* Jam Realtime + info RFID */}
              <div className="flex flex-col gap-1">
                <RealTimeClock />
                {profile?.rfid_uid && (
                  <div className="text-xs text-slate-600 bg-white rounded-2xl px-3 py-2 border border-slate-200 flex items-center gap-2 shadow-sm">
                    <span className="text-green-600">💳</span>
                    <div className="flex-1">
                      <div className="font-medium">
                        RFID: {(profile.rfid_uid || '').toUpperCase()}
                      </div>
                      <div
                        className={`text-[10px] ${rfidListening ? 'text-green-600' : 'text-red-500'
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
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md">
          <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-gray-50 to-white">
            <div className="flex items-center gap-3">
              <div className="w-2 h-8 bg-indigo-600 rounded-full"></div>
              <h2 className="text-xl font-bold text-slate-900">Menu Absensi</h2>
            </div>
          </div>
          <div className="border-b border-slate-200">
            <div className="flex gap-2 px-3 pt-2">
              <button
                className={`px-3 py-2 font-medium border-b-2 rounded-t-2xl transition-all duration-200 flex items-center space-x-1 text-sm ${tab === 'manual'
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
                onClick={() => setTab('manual')}
              >
                <span>📝</span>
                <span>Absen Manual</span>
              </button>
              <button
                className={`px-3 py-2 font-medium border-b-2 rounded-t-2xl transition-all duration-200 flex items-center gap-1.5 text-sm ${tab === 'qr'
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
                onClick={() => setTab('qr')}
              >
                <QrCode className="h-4 w-4" />
                <span>Scan QR</span>
              </button>
              <button
                className={`px-3 py-2 font-medium border-b-2 rounded-t-2xl transition-all duration-200 flex items-center space-x-1 text-sm ${tab === 'jadwal'
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
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
              <div className="space-y-5">
                <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
                  {/* Filter */}
                  <div className="xl:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md">
                    <div className="px-4 py-3 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-7 bg-blue-600 rounded-full"></div>
                        <h3 className="font-semibold text-base text-slate-900">
                          Pilih Mapel & Tanggal
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1 ml-5">
                        Pilih mata pelajaran yang diajar hari itu, lalu lakukan absensi.
                      </p>
                    </div>
                    <div className="p-4 grid md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold tracking-wide text-slate-600 uppercase mb-1.5">
                          Tanggal Absen
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="date"
                            className="flex-1 px-3 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white text-sm"
                            value={tgl}
                            onChange={(e) => setTgl(e.target.value)}
                            max={getToday()}
                          />
                          <button
                            type="button"
                            onClick={() => setTgl(getToday())}
                            className="px-3 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm shadow-sm whitespace-nowrap"
                          >
                            Hari Ini
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold tracking-wide text-slate-600 uppercase mb-1.5">
                          Mata Pelajaran
                        </label>
                        <select
                          className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white text-sm"
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

                  {/* Status sesi hari ini */}
                  <div
                    className={`xl:col-span-2 rounded-2xl border p-4 shadow-sm transition-all duration-200 ${currentJadwal && tgl === getToday()
                      ? isAbsenOpen && currentJadwal.mode === 'otomatis'
                        ? 'bg-green-50 border-green-200 text-green-900'
                        : currentJadwalIndex !== -1
                          ? 'bg-blue-50 border-blue-200 text-blue-900'
                          : 'bg-slate-50 border-slate-200 text-slate-800'
                      : 'bg-slate-50 border-slate-200 text-slate-800'
                      }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-sm flex items-center gap-2">
                          <span>🛰️</span>
                          <span>Status Sesi Hari Ini</span>
                        </h3>
                        <p className="text-[11px] mt-1 opacity-80">
                          {tgl === getToday()
                            ? 'Update real-time berdasarkan jadwal aktif.'
                            : 'Status sesi detail tampil untuk tanggal hari ini.'}
                        </p>
                      </div>
                      {tgl === getToday() && currentJadwal ? (
                        isAbsenOpen && currentJadwal.mode === 'otomatis' ? (
                          <Badge variant="live" className="text-[10px] shrink-0">
                            SESI DIBUKA
                          </Badge>
                        ) : currentJadwalIndex !== -1 ? (
                          <Badge variant="info" className="text-[10px] shrink-0">
                            JADWAL AKTIF
                          </Badge>
                        ) : (
                          <Badge variant="warning" className="text-[10px] shrink-0">
                            {currentJadwal.mode === 'manual'
                              ? 'MODE MANUAL'
                              : 'SESI DITUTUP'}
                          </Badge>
                        )
                      ) : null}
                    </div>

                    {currentJadwal && tgl === getToday() ? (
                      <div className="mt-3 space-y-2 text-xs">
                        <div className="font-semibold text-sm">{currentJadwal.mapel}</div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-xl bg-white/70 border border-white px-2.5 py-2">
                            <div className="text-[10px] uppercase tracking-wide opacity-70">Jam</div>
                            <div className="font-medium mt-0.5">
                              {currentJadwal.jam_mulai} - {currentJadwal.jam_selesai}
                            </div>
                          </div>
                          <div className="rounded-xl bg-white/70 border border-white px-2.5 py-2">
                            <div className="text-[10px] uppercase tracking-wide opacity-70">Mode</div>
                            <div className="font-medium mt-0.5">
                              {currentJadwal.mode === 'otomatis' ? 'Otomatis' : 'Manual'}
                            </div>
                          </div>
                        </div>
                        {currentJadwal.guru_nama && (
                          <div className="text-[11px] opacity-90">
                            Guru: <span className="font-semibold">{currentJadwal.guru_nama}</span>
                          </div>
                        )}
                        {rfidSettings.rfid_aktif && (
                          <div className="text-[11px] opacity-90">
                            RFID:{' '}
                            <span className="font-semibold">
                              {isInRfidTimeRange() ? 'AKTIF' : 'NON-AKTIF'}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 text-xs text-slate-600">
                        Belum ada sesi aktif yang bisa ditampilkan untuk pilihan saat ini.
                      </div>
                    )}
                  </div>
                </div>

                {/* Ringkasan kelas */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md">
                  <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-gray-50 to-white flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-7 bg-emerald-600 rounded-full"></div>
                      <h3 className="font-semibold text-base text-slate-900">
                        Daftar Absensi Kelas
                      </h3>
                    </div>
                    <Badge variant="live" className="text-[10px]">Live</Badge>
                  </div>

                  <div className="p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {status ? (
                        <Badge
                          variant={
                            status === 'Hadir'
                              ? 'hadir'
                              : status === 'Izin'
                                ? 'izin'
                                : status === 'Sakit'
                                  ? 'sakit'
                                  : 'alpha'
                          }
                        >
                          Status Anda: {status}
                        </Badge>
                      ) : (
                        <Badge variant="warning">
                          Status Anda: Belum Absen
                        </Badge>
                      )}
                      {rfidSettings.rfid_aktif && (
                        <span className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1">
                          RFID {isInRfidTimeRange() ? 'AKTIF' : 'NON-AKTIF'} (
                          {rfidSettings.rfid_mulai} - {rfidSettings.rfid_selesai})
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                      <div className="rounded-2xl border border-green-200 bg-green-50 p-3">
                        <div className="text-[11px] text-green-700 font-semibold">Hadir</div>
                        <div className="text-2xl font-bold text-green-700 mt-1">{ringkas.H}</div>
                      </div>
                      <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-3">
                        <div className="text-[11px] text-yellow-700 font-semibold">Izin</div>
                        <div className="text-2xl font-bold text-yellow-700 mt-1">{ringkas.I}</div>
                      </div>
                      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3">
                        <div className="text-[11px] text-blue-700 font-semibold">Sakit</div>
                        <div className="text-2xl font-bold text-blue-700 mt-1">{ringkas.S}</div>
                      </div>
                      <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
                        <div className="text-[11px] text-red-700 font-semibold">Alpha</div>
                        <div className="text-2xl font-bold text-red-700 mt-1">{ringkas.A}</div>
                      </div>
                    </div>

                    <RingkasanKelasTable
                      kelas={profile?.kelas}
                      mapel={mapel}
                      tanggal={tgl}
                      selfUserId={userId}
                      canClickHadir={!isHadirActionDisabled}
                      canClickIzin={!isIzinActionDisabled}
                      izinDisabledReason={izinAvailability.reason}
                      onHadir={() => submit('Hadir')}
                      onIzin={() => setIsIzinModalOpen(true)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* === TAB QR === */}
            {tab === 'qr' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 grid place-items-center">
                        <QrCode className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900">Absensi QR</h3>
                        <p className="text-xs text-slate-500">
                          Scan QR dari guru saat jam pelajaran sedang berlangsung.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={status === 'Hadir' ? 'hadir' : 'warning'}>
                        Status Anda: {status || 'Belum Absen'}
                      </Badge>
                      {mapel && <Badge variant="info">{mapel}</Badge>}
                    </div>
                  </div>
                </div>

                <QrScannerPanel
                  onSubmitToken={handleQrScanToken}
                  isSubmitting={isQrSubmitting}
                  lastError={qrScanError}
                />
              </div>
            )}

            {/* === TAB JADWAL === */}
            {tab === 'jadwal' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-2 h-7 bg-indigo-600 rounded-full"></div>
                    <h3 className="font-semibold text-base text-slate-800">
                      Jadwal Pelajaran Minggu Ini
                    </h3>
                  </div>
                  <p className="text-slate-600 text-xs font-medium">
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
                    <p className="text-slate-600 text-sm">Memuat jadwal...</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {hariOrder.map((hari) => {
                      const jadwalHari = jadwalMingguIni[hari] || []
                      const isHariIni = hari === getDayName(getToday())

                      return (
                        <div
                          key={hari}
                          className="border border-slate-200 rounded-2xl overflow-hidden"
                        >
                          <div
                            className={`px-4 py-3 border-b ${isHariIni
                              ? 'bg-blue-50 border-blue-200'
                              : 'bg-slate-50 border-slate-200'
                              }`}
                          >
                            <div className="flex items-center justify-between">
                              <h3
                                className={`font-semibold ${isHariIni
                                  ? 'text-blue-800'
                                  : 'text-slate-700'
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
                              <div className="text-center py-6 text-slate-500">
                                <div className="w-12 h-12 mx-auto mb-2 bg-slate-100 rounded-full flex items-center justify-center">
                                  <svg
                                    className="w-6 h-6 text-slate-400"
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
                                <div className="font-medium text-slate-600">
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
          <div className="bg-white rounded-2xl p-5 w-full max-w-md shadow-2xl border border-slate-200">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 bg-yellow-100 rounded-2xl flex items-center justify-center text-yellow-600 text-sm">
                📝
              </div>
              <div>
                <div className="font-semibold text-slate-900 text-sm">
                  Ajukan Izin
                </div>
                <div className="text-slate-500 text-xs">
                  Masukkan alasan izin Anda
                </div>
              </div>
            </div>

            <div className="mb-3 space-y-2">
              <div className="text-xs text-slate-700 bg-slate-50 p-2 rounded-2xl border border-slate-200">
                <span className="font-medium">Mapel:</span> {mapel}
              </div>
              <div className="text-xs text-slate-700 bg-slate-50 p-2 rounded-2xl border border-slate-200">
                <span className="font-medium">Tanggal:</span> {tgl}
              </div>
              <textarea
                className="w-full px-3 py-2 border border-slate-300 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 resize-none bg-white text-xs"
                placeholder="Contoh: Sakit, acara keluarga, izin sakit, dll."
                value={izinReason}
                onChange={(e) => setIzinReason(e.target.value)}
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-2 border border-slate-300 text-slate-700 rounded-2xl hover:bg-slate-50 transition-all duration-200 font-medium text-xs"
                onClick={() => setIsIzinModalOpen(false)}
              >
                Batal
              </button>
              <button
                className={`px-3 py-2 rounded-2xl font-medium transition-all duration-200 text-xs ${isSubmitting
                  ? 'bg-slate-400 cursor-not-allowed text-white'
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
