import {
  SEMESTER_GANJIL,
  SEMESTER_GENAP,
  normalizeSemester
} from './academicPeriod'

export const SCHEDULE_SCOPE_YEAR = 'tahunan'
export const SCHEDULE_SCOPE_GANJIL = 'ganjil'
export const SCHEDULE_SCOPE_GENAP = 'genap'

export const SCHEDULE_SCOPE_OPTIONS = [
  {
    value: SCHEDULE_SCOPE_YEAR,
    label: '1 Tahun Ajaran',
    shortLabel: 'Tahunan'
  },
  {
    value: SCHEDULE_SCOPE_GANJIL,
    label: 'Semester Ganjil saja',
    shortLabel: 'Ganjil'
  },
  {
    value: SCHEDULE_SCOPE_GENAP,
    label: 'Semester Genap saja',
    shortLabel: 'Genap'
  }
]

export const normalizeScheduleScope = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (['ganjil', 'gasal', 'semester_ganjil', 'semester ganjil', '1'].includes(raw)) {
    return SCHEDULE_SCOPE_GANJIL
  }
  if (['genap', 'semester_genap', 'semester genap', '2'].includes(raw)) {
    return SCHEDULE_SCOPE_GENAP
  }
  return SCHEDULE_SCOPE_YEAR
}

export const scheduleScopeFromRow = (row = {}) => normalizeScheduleScope(row.periode_berlaku)

export const scheduleScopeToSemester = (scope) => {
  const normalized = normalizeScheduleScope(scope)
  if (normalized === SCHEDULE_SCOPE_GANJIL) return SEMESTER_GANJIL
  if (normalized === SCHEDULE_SCOPE_GENAP) return SEMESTER_GENAP
  return ''
}

export const scheduleScopeLabel = (scope, { short = false } = {}) => {
  const normalized = normalizeScheduleScope(scope)
  const option = SCHEDULE_SCOPE_OPTIONS.find((item) => item.value === normalized)
  if (!option) return short ? 'Tahunan' : '1 Tahun Ajaran'
  return short ? option.shortLabel : option.label
}

export const isScheduleApplicableToSemester = (row = {}, semester = '') => {
  const scope = scheduleScopeFromRow(row)
  if (scope === SCHEDULE_SCOPE_YEAR) return true
  return scheduleScopeToSemester(scope) === normalizeSemester(semester)
}

export const filterSchedulesForSemester = (rows = [], semester = '') => (
  (rows || []).filter((row) => isScheduleApplicableToSemester(row, semester))
)

export const doScheduleScopesOverlap = (leftScope, rightScope) => {
  const left = normalizeScheduleScope(leftScope)
  const right = normalizeScheduleScope(rightScope)
  return left === SCHEDULE_SCOPE_YEAR || right === SCHEDULE_SCOPE_YEAR || left === right
}
