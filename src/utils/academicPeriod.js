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

const sortAndUniqueMonths = (months = []) => {
  const byValue = new Map()
  months.forEach((month) => {
    if (!month?.value) return
    byValue.set(month.value, month)
  })

  return Array.from(byValue.values()).sort((a, b) => {
    const aKey = `${a.year || 0}-${String(a.month || 0).padStart(2, '0')}`
    const bKey = `${b.year || 0}-${String(b.month || 0).padStart(2, '0')}`
    return aKey.localeCompare(bKey)
  })
}

export const getAcademicYearMonths = (tahunAjaran, options = {}) => {
  const normalizedYear = normalizeAcademicYear(tahunAjaran)
  if (!normalizedYear) return []

  const ganjilCustom = getCustomPeriodMonths(
    normalizedYear,
    options.periodeGanjilMulai || options.periode_ganjil_mulai,
    options.periodeGanjilSelesai || options.periode_ganjil_selesai
  )
  const genapCustom = getCustomPeriodMonths(
    normalizedYear,
    options.periodeGenapMulai || options.periode_genap_mulai,
    options.periodeGenapSelesai || options.periode_genap_selesai
  )

  const ganjilMonths = ganjilCustom.length
    ? ganjilCustom
    : getSemesterMonths(normalizedYear, SEMESTER_GANJIL)
  const genapMonths = genapCustom.length
    ? genapCustom
    : getSemesterMonths(normalizedYear, SEMESTER_GENAP)

  return sortAndUniqueMonths([...ganjilMonths, ...genapMonths])
}

export const normalizePeriodDate = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const dateValue = /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return ''
  const date = new Date(`${dateValue}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  return toDateString(date)
}

export const toMonthInputValue = (value) => {
  const normalized = normalizePeriodDate(value)
  return normalized ? normalized.slice(0, 7) : ''
}

export const semesterRangeFields = (semester) => {
  const normalizedSemester = normalizeSemester(semester)
  if (normalizedSemester === SEMESTER_GANJIL) {
    return {
      start: 'periode_ganjil_mulai',
      end: 'periode_ganjil_selesai',
      camelStart: 'periodeGanjilMulai',
      camelEnd: 'periodeGanjilSelesai'
    }
  }
  if (normalizedSemester === SEMESTER_GENAP) {
    return {
      start: 'periode_genap_mulai',
      end: 'periode_genap_selesai',
      camelStart: 'periodeGenapMulai',
      camelEnd: 'periodeGenapSelesai'
    }
  }
  return null
}

export const getSemesterRangeFromSettings = (settings = {}, semester) => {
  const fields = semesterRangeFields(semester)
  if (!fields) {
    return {
      startsAt: settings?.periode_mulai || settings?.periodeMulai || settings?.startsAt,
      endsAt: settings?.periode_selesai || settings?.periodeSelesai || settings?.endsAt
    }
  }

  const startsAt =
    settings?.[fields.start] ||
    settings?.[fields.camelStart] ||
    settings?.periode_mulai ||
    settings?.periodeMulai ||
    settings?.startsAt
  const endsAt =
    settings?.[fields.end] ||
    settings?.[fields.camelEnd] ||
    settings?.periode_selesai ||
    settings?.periodeSelesai ||
    settings?.endsAt

  return { startsAt, endsAt }
}

export const getCustomPeriodMonths = (tahunAjaran, startsAt, endsAt) => {
  const normalizedYear = normalizeAcademicYear(tahunAjaran)
  const startDate = normalizePeriodDate(startsAt)
  const endDate = normalizePeriodDate(endsAt)
  if (!normalizedYear || !startDate || !endDate) return []

  const academicStartYear = Number(normalizedYear.slice(0, 4))
  const academicStart = new Date(academicStartYear, 6, 1)
  const academicEnd = new Date(academicStartYear + 1, 5, 30)
  const start = new Date(`${startDate}T00:00:00`)
  const end = endOfMonth(
    Number(endDate.slice(0, 4)),
    Number(endDate.slice(5, 7))
  )

  if (start > end || start < academicStart || end > academicEnd) return []

  const diffMonths =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth())
  if (diffMonths > 11) return []

  const months = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  while (cursor <= end) {
    const month = cursor.getMonth() + 1
    const year = cursor.getFullYear()
    const name = MONTH_NAMES_ID[month]
    const monthStart = new Date(year, month - 1, 1)
    const monthEnd = endOfMonth(year, month)
    months.push({
      month,
      year,
      value: `${year}-${String(month).padStart(2, '0')}`,
      name,
      label: `${name} ${year}`,
      shortLabel: `${name.slice(0, 3)} ${year}`,
      startDate: toDateString(monthStart),
      endDate: toDateString(monthEnd)
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }

  return months
}

export const buildAcademicPeriod = (tahunAjaran, semester, options = {}) => {
  const current = getCurrentAcademicPeriodBase()
  const normalizedYear = normalizeAcademicYear(tahunAjaran) || current.tahunAjaran
  const normalizedSemester = normalizeSemester(semester) || current.semester
  const startYear = Number(normalizedYear.slice(0, 4)) || current.startYear
  const customMonths = getCustomPeriodMonths(
    normalizedYear,
    options.periodeMulai || options.periode_mulai || options.startsAt,
    options.periodeSelesai || options.periode_selesai || options.endsAt
  )
  const months = customMonths.length
    ? customMonths
    : getSemesterMonths(normalizedYear, normalizedSemester)
  const academicYearMonths = getAcademicYearMonths(normalizedYear, {
    periodeGanjilMulai: options.periodeGanjilMulai || options.periode_ganjil_mulai,
    periodeGanjilSelesai: options.periodeGanjilSelesai || options.periode_ganjil_selesai,
    periodeGenapMulai: options.periodeGenapMulai || options.periode_genap_mulai,
    periodeGenapSelesai: options.periodeGenapSelesai || options.periode_genap_selesai
  })
  const firstMonth = months[0] || null
  const lastMonth = months[months.length - 1] || null
  const firstAcademicMonth = academicYearMonths[0] || null
  const lastAcademicMonth = academicYearMonths[academicYearMonths.length - 1] || null

  return {
    tahunAjaran: normalizedYear,
    semester: normalizedSemester,
    startYear,
    endYear: startYear + 1,
    months,
    academicYearMonths,
    monthNumbers: months.map((item) => item.month),
    monthLabels: months.map((item) => item.label),
    academicYearMonthNumbers: academicYearMonths.map((item) => item.month),
    academicYearMonthLabels: academicYearMonths.map((item) => item.label),
    startsAt: firstMonth?.startDate || '',
    endsAt: lastMonth?.endDate || '',
    academicYearStartsAt: firstAcademicMonth?.startDate || '',
    academicYearEndsAt: lastAcademicMonth?.endDate || '',
    periodeMulai: firstMonth?.startDate || '',
    periodeSelesai: lastMonth?.endDate || '',
    customRange: customMonths.length > 0,
    rangeLabel: firstMonth && lastMonth ? `${firstMonth.label} - ${lastMonth.label}` : '',
    academicYearRangeLabel: firstAcademicMonth && lastAcademicMonth ? `${firstAcademicMonth.label} - ${lastAcademicMonth.label}` : '',
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
  const tahunAjaran = normalizeAcademicYear(settings?.tahun_ajaran || settings?.tahunAjaran) || current.tahunAjaran
  const semester = normalizeSemester(settings?.semester_aktif || settings?.semesterAktif || settings?.semester) || current.semester
  const semesterRange = getSemesterRangeFromSettings(settings, semester)
  const period = buildAcademicPeriod(tahunAjaran, semester, {
    periode_mulai: semesterRange.startsAt,
    periode_selesai: semesterRange.endsAt,
    periode_ganjil_mulai: settings?.periode_ganjil_mulai || settings?.periodeGanjilMulai,
    periode_ganjil_selesai: settings?.periode_ganjil_selesai || settings?.periodeGanjilSelesai,
    periode_genap_mulai: settings?.periode_genap_mulai || settings?.periodeGenapMulai,
    periode_genap_selesai: settings?.periode_genap_selesai || settings?.periodeGenapSelesai
  })

  return {
    ...period,
    periodeGanjilMulai: normalizePeriodDate(settings?.periode_ganjil_mulai || settings?.periodeGanjilMulai),
    periodeGanjilSelesai: normalizePeriodDate(settings?.periode_ganjil_selesai || settings?.periodeGanjilSelesai),
    periodeGenapMulai: normalizePeriodDate(settings?.periode_genap_mulai || settings?.periodeGenapMulai),
    periodeGenapSelesai: normalizePeriodDate(settings?.periode_genap_selesai || settings?.periodeGenapSelesai)
  }
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

export const ACADEMIC_YEAR_OPTIONS_BACK = 5
export const ACADEMIC_YEAR_OPTIONS_FORWARD = 15

/**
 * Generate academic year dropdown options based on real-time calendar year.
 * Returns options from (currentYear - back) to (currentYear + forward) in format "YYYY/YYYY".
 * The option matching the current academic year is flagged as `isCurrent`.
 *
 * @param {object} options
 * @param {number} [options.back=5] - How many years back from current
 * @param {number} [options.forward=15] - How many years forward from current
 * @param {Date} [options.date] - Reference date (default: now)
 * @returns {{ value: string, label: string, isCurrent: boolean }[]}
 */
export const generateAcademicYearOptions = ({
  back = ACADEMIC_YEAR_OPTIONS_BACK,
  forward = ACADEMIC_YEAR_OPTIONS_FORWARD,
  date
} = {}) => {
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
