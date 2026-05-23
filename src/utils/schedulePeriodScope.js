export const SCHEDULE_SCOPE_YEAR = 'tahunan'
export const SCHEDULE_SCOPE_GANJIL = 'ganjil'
export const SCHEDULE_SCOPE_GENAP = 'genap'

export const SCHEDULE_SCOPE_OPTIONS = [
  {
    value: SCHEDULE_SCOPE_YEAR,
    label: '1 Tahun Ajaran',
    shortLabel: 'Tahunan'
  }
]

export const normalizeScheduleScope = () => SCHEDULE_SCOPE_YEAR

export const scheduleScopeFromRow = () => SCHEDULE_SCOPE_YEAR

export const scheduleScopeToSemester = () => ''

export const scheduleScopeLabel = (scope, { short = false } = {}) => {
  const normalized = normalizeScheduleScope(scope)
  const option = SCHEDULE_SCOPE_OPTIONS.find((item) => item.value === normalized)
  if (!option) return short ? 'Tahunan' : '1 Tahun Ajaran'
  return short ? option.shortLabel : option.label
}

export const isScheduleApplicableToSemester = () => true

export const filterSchedulesForSemester = (rows = []) => rows || []

export const doScheduleScopesOverlap = () => true
