// src/pages/guru/absensi/absensiGuruUtils.js
import {
  normalizeAcademicYear,
  normalizeSemester,
  resolveAcademicPeriod
} from '../../../utils/academicPeriod'

let qrCodePromise = null

export const JADWAL_COLUMNS = 'id,kelas_id,hari,mapel,guru_id,guru_nama,jam_mulai,jam_selesai,created_at,updated_at,tahun_ajaran,semester'
export const STUDENT_COLUMNS = 'id,nama,kelas,role,photo_url,photo_path,photo_updated_at,rfid_uid,status,updated_at'
export const GURU_COLUMNS = 'id,nama'
export const ABSENSI_COLUMNS = 'id,kelas,tanggal,uid,mapel,status,nama,waktu,komentar,oleh,dikonfirmasi,tahun_ajaran,semester'
export const AJUAN_COLUMNS = 'id,kelas,tanggal,uid,nama,alasan,mapel,created_at,status_guru,kategori_final,guru_id,guru_nama,waktu_respon,tahun_ajaran,semester'
export const JAM_KOSONG_COLUMNS = 'id,tanggal,kelas,mapel,jam_mulai,jam_selesai,alasan,guru_pengganti,created_by,created_at,updated_at'

export function initials(name = '?') {
  const parts = (name || '').trim().split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('')
}

export const formatKelasDisplay = (kelasSlug) => {
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

export const getToday = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const toMinutes = (hhmm) => {
  if (!hhmm) return 0
  const [h, m] = hhmm.split(':').map(Number)
  return (h * 60) + (m || 0)
}

export const normalizeRfidUid = (value = '') => (
  String(value || '').toUpperCase().replace(/\s+/g, '')
)

export const getDayName = (tglString) => {
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

export const getCurrentDateTime = () => {
  const now = new Date()
  return {
    date: now.toISOString().slice(0, 10),
    time: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
    dayName: getDayName(now.toISOString().slice(0, 10)),
    minutes: now.getHours() * 60 + now.getMinutes()
  }
}

export const isSameClockMinute = (left, right) => (
  left?.date === right?.date &&
  left?.dayName === right?.dayName &&
  left?.minutes === right?.minutes
)

export const getMsUntilNextMinute = () => {
  const now = new Date()
  return Math.max(1000, (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50)
}

export const formatDateDisplay = (dateString) => {
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

export const getAcademicYearOptions = (period = resolveAcademicPeriod()) => {
  const start = Number(period.startYear || String(period.tahunAjaran || '').slice(0, 4)) || resolveAcademicPeriod().startYear
  return Array.from({ length: 5 }, (_, index) => {
    const year = start - 2 + index
    return `${year}/${year + 1}`
  })
}

export const normalizePeriodFilter = (period = {}) => {
  const fallback = resolveAcademicPeriod()
  return {
    tahunAjaran: normalizeAcademicYear(period.tahunAjaran || period.tahun_ajaran) || fallback.tahunAjaran,
    semester: normalizeSemester(period.semester || period.semester_aktif) || fallback.semester
  }
}

export const dateToMonthState = (dateString = getToday()) => {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(dateString) ? dateString : getToday()
  const [year, month] = safeDate.split('-').map(Number)
  return { year, month }
}

export const monthLabel = ({ year, month }) => (
  new Date(year, month - 1, 1).toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric'
  })
)

export const shiftMonth = ({ year, month }, delta) => {
  const next = new Date(year, month - 1 + delta, 1)
  return { year: next.getFullYear(), month: next.getMonth() + 1 }
}

export const buildMonthCalendar = ({ year, month }) => {
  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDay = new Date(year, month - 1, 1).getDay()
  const cells = []

  for (let i = 0; i < firstDay; i += 1) cells.push(null)
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }

  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export const loadQRCode = () => {
  if (!qrCodePromise) {
    qrCodePromise = import('qrcode').then((mod) => mod.default || mod)
  }
  return qrCodePromise
}

export const buildQrScanValue = (token) => {
  const cleanToken = String(token || '').trim()
  if (!cleanToken) return ''
  if (typeof window === 'undefined' || !window.location?.origin) return cleanToken

  return `${window.location.origin}/siswa/absensi?qr=${encodeURIComponent(cleanToken)}`
}

