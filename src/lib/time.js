import { format, isAfter } from 'date-fns'

const SQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

export const parseDateTime = (value) => {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value !== 'string') return null

  const raw = value.trim()
  if (!raw) return null

  if (DATE_ONLY_RE.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number)
    return new Date(year, month - 1, day)
  }

  // Laravel query builder returns UTC database datetimes as "YYYY-MM-DD HH:mm:ss"
  // without a timezone suffix. Browsers read that shape as local time, so mark it UTC.
  const normalized = SQL_DATETIME_RE.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? null : d
}

export const formatDateTime = (date) => {
  if (!date) return '-'
  const d = parseDateTime(date)
  if (!d) return '-'
  return format(d, 'dd/MM/yyyy HH:mm')
}

export const formatDate = (date) => {
  if (!date) return '-'
  const d = parseDateTime(date)
  if (!d) return '-'
  return format(d, 'dd/MM/yyyy')
}

export const isPast = (time) => {
  if (!time) return false
  const d = parseDateTime(time)
  if (!d) return false
  return isAfter(new Date(), d)
}


// BARU: Tambahkan fungsi todayKey untuk format YYYY-MM-DD
export const todayKey = () => {
  return format(new Date(), 'yyyy-MM-dd')
}
