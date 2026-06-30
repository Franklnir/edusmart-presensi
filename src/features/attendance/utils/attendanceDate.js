import {
  ACADEMIC_YEAR_OPTIONS_BACK,
  ACADEMIC_YEAR_OPTIONS_FORWARD,
  SEMESTER_GANJIL,
  SEMESTER_GENAP,
  normalizeAcademicYear,
  normalizeSemester,
  resolveAcademicPeriod
} from '../../../utils/academicPeriod'

export { SEMESTER_GANJIL, SEMESTER_GENAP, resolveAcademicPeriod }

export const SEMESTER_OPTIONS = [
  { value: SEMESTER_GANJIL, label: 'Semester 1 (Ganjil)' },
  { value: SEMESTER_GENAP, label: 'Semester 2 (Genap)' }
]

export const getToday = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const getDayName = (tglString) => {
  const date = new Date(`${tglString}T12:00:00Z`)
  const dayIndex = date.getUTCDay()
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
  return dayNames[dayIndex] || ''
}

export const toMinutes = (hhmm) => {
  if (!hhmm) return 0
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

export const getCurrentDateTime = () => {
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

export const getAcademicYearOptions = (period = resolveAcademicPeriod()) => {
  const start = Number(period.startYear || String(period.tahunAjaran || '').slice(0, 4)) || resolveAcademicPeriod().startYear
  return Array.from({ length: ACADEMIC_YEAR_OPTIONS_BACK + ACADEMIC_YEAR_OPTIONS_FORWARD + 1 }, (_, index) => {
    const year = start - ACADEMIC_YEAR_OPTIONS_BACK + index
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
