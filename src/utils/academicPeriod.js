export const SEMESTER_GANJIL = 'Ganjil'
export const SEMESTER_GENAP = 'Genap'

export const MONTH_NAMES_ID = [
  '',
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

const toDateString = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const endOfMonth = (year, monthNumber) => new Date(year, monthNumber, 0)

export const getSemesterMonths = (tahunAjaran, semester) => {
  const normalizedYear = normalizeAcademicYear(tahunAjaran)
  const normalizedSemester = normalizeSemester(semester)
  if (!normalizedYear || !normalizedSemester) return []

  const startYear = Number(normalizedYear.slice(0, 4))
  if (!Number.isFinite(startYear) || startYear <= 0) return []

  const monthNumbers =
    normalizedSemester === SEMESTER_GANJIL
      ? [7, 8, 9, 10, 11, 12]
      : [1, 2, 3, 4, 5, 6]
  const calendarYear =
    normalizedSemester === SEMESTER_GANJIL ? startYear : startYear + 1

  return monthNumbers.map((month) => {
    const name = MONTH_NAMES_ID[month]
    const startDate = new Date(calendarYear, month - 1, 1)
    const endDate = endOfMonth(calendarYear, month)

    return {
      month,
      year: calendarYear,
      value: `${calendarYear}-${String(month).padStart(2, '0')}`,
      name,
      label: `${name} ${calendarYear}`,
      shortLabel: `${name.slice(0, 3)} ${calendarYear}`,
      startDate: toDateString(startDate),
      endDate: toDateString(endDate)
    }
  })
}

export const buildAcademicPeriod = (tahunAjaran, semester) => {
  const current = getCurrentAcademicPeriodBase()
  const normalizedYear = normalizeAcademicYear(tahunAjaran) || current.tahunAjaran
  const normalizedSemester = normalizeSemester(semester) || current.semester
  const startYear = Number(normalizedYear.slice(0, 4)) || current.startYear
  const months = getSemesterMonths(normalizedYear, normalizedSemester)
  const firstMonth = months[0] || null
  const lastMonth = months[months.length - 1] || null

  return {
    tahunAjaran: normalizedYear,
    semester: normalizedSemester,
    startYear,
    endYear: startYear + 1,
    months,
    monthNumbers: months.map((item) => item.month),
    monthLabels: months.map((item) => item.label),
    startsAt: firstMonth?.startDate || '',
    endsAt: lastMonth?.endDate || '',
    rangeLabel: firstMonth && lastMonth ? `${firstMonth.label} - ${lastMonth.label}` : '',
    label: `${normalizedYear} - Semester ${normalizedSemester}`
  }
}

const getCurrentAcademicPeriodBase = (date = new Date()) => {
  const month = date.getMonth() + 1
  const year = date.getFullYear()
  const startYear = month >= 7 ? year : year - 1

  return {
    tahunAjaran: `${startYear}/${startYear + 1}`,
    semester: month >= 7 ? SEMESTER_GANJIL : SEMESTER_GENAP,
    startYear,
    endYear: startYear + 1
  }
}

export const getCurrentAcademicPeriod = (date = new Date()) => {
  const current = getCurrentAcademicPeriodBase(date)
  return buildAcademicPeriod(current.tahunAjaran, current.semester)
}

export const normalizeAcademicYear = (value) => {
  const raw = String(value || '').trim().replace(/\s+/g, '')
  if (!raw) return ''

  const range = raw.match(/^(\d{4})[/-](\d{4})$/)
  if (range) {
    const start = Number(range[1])
    const end = Number(range[2])
    if (end === start + 1) return `${start}/${end}`
  }

  if (/^\d{4}$/.test(raw)) {
    const start = Number(raw)
    return `${start}/${start + 1}`
  }

  return ''
}

export const normalizeSemester = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  if (['1', 'ganjil', 'gasal', 'odd'].includes(raw)) return SEMESTER_GANJIL
  if (['2', 'genap', 'even'].includes(raw)) return SEMESTER_GENAP
  return ''
}

export const resolveAcademicPeriod = (settings = {}) => {
  const current = getCurrentAcademicPeriod()
  const tahunAjaran = normalizeAcademicYear(settings?.tahun_ajaran) || current.tahunAjaran
  const semester = normalizeSemester(settings?.semester_aktif || settings?.semester) || current.semester
  return buildAcademicPeriod(tahunAjaran, semester)
}

export const getNextAcademicPeriod = ({ tahunAjaran, semester } = {}) => {
  const current = resolveAcademicPeriod({ tahun_ajaran: tahunAjaran, semester_aktif: semester })
  if (current.semester === SEMESTER_GANJIL) {
    return buildAcademicPeriod(current.tahunAjaran, SEMESTER_GENAP)
  }

  return buildAcademicPeriod(`${current.startYear + 1}/${current.startYear + 2}`, SEMESTER_GANJIL)
}

export const inferCohortYear = (grade, academicStartYear = getCurrentAcademicPeriod().startYear) => {
  let normalized = String(grade || '').trim().toUpperCase()
  const romanPrefix = normalized.match(/^(XII|XI|X|IX|VIII|VII)\b/)
  if (romanPrefix) normalized = romanPrefix[1]
  const offsetByGrade = {
    VIII: -1,
    IX: -2,
    XI: -1,
    XII: -2
  }

  return String(academicStartYear + (offsetByGrade[normalized] || 0))
}

/**
 * Generate academic year dropdown options based on real-time calendar year.
 * Returns options from (currentYear - back) to (currentYear + forward) in format "YYYY/YYYY".
 * The option matching the current academic year is flagged as `isCurrent`.
 *
 * @param {object} options
 * @param {number} [options.back=5] - How many years back from current
 * @param {number} [options.forward=2] - How many years forward from current
 * @param {Date} [options.date] - Reference date (default: now)
 * @returns {{ value: string, label: string, isCurrent: boolean }[]}
 */
export const generateAcademicYearOptions = ({ back = 5, forward = 2, date } = {}) => {
  const now = date || new Date()
  const month = now.getMonth() + 1
  const calendarYear = now.getFullYear()
  const currentStartYear = month >= 7 ? calendarYear : calendarYear - 1
  const firstStartYear = currentStartYear - back
  const lastStartYear = currentStartYear + forward

  const options = []
  for (let startYear = firstStartYear; startYear <= lastStartYear; startYear += 1) {
    const value = `${startYear}/${startYear + 1}`
    options.push({
      value,
      label: `${startYear}/${startYear + 1}`,
      isCurrent: startYear === currentStartYear
    })
  }

  return options
}
