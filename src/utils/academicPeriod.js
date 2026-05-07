export const SEMESTER_GANJIL = 'Ganjil'
export const SEMESTER_GENAP = 'Genap'

export const getCurrentAcademicPeriod = (date = new Date()) => {
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
  const startYear = Number(tahunAjaran.slice(0, 4)) || current.startYear

  return {
    tahunAjaran,
    semester,
    startYear,
    endYear: startYear + 1
  }
}

export const getNextAcademicPeriod = ({ tahunAjaran, semester } = {}) => {
  const current = resolveAcademicPeriod({ tahun_ajaran: tahunAjaran, semester_aktif: semester })
  if (current.semester === SEMESTER_GANJIL) {
    return {
      ...current,
      semester: SEMESTER_GENAP
    }
  }

  return {
    tahunAjaran: `${current.startYear + 1}/${current.startYear + 2}`,
    semester: SEMESTER_GANJIL,
    startYear: current.startYear + 1,
    endYear: current.startYear + 2
  }
}

export const inferCohortYear = (grade, academicStartYear = getCurrentAcademicPeriod().startYear) => {
  const normalized = String(grade || '').trim().toUpperCase()
  const offsetByGrade = {
    VIII: -1,
    IX: -2,
    XI: -1,
    XII: -2
  }

  return String(academicStartYear + (offsetByGrade[normalized] || 0))
}
