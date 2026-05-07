import { format, isAfter, parseISO } from 'date-fns'

export const formatDateTime = (date) => {
  if (!date) return '-'
  const d = typeof date === 'string' ? new Date(date) : date
  return format(d, 'dd/MM/yyyy HH:mm')
}

export const formatDate = (date) => {
  if (!date) return '-'
  const d = typeof date === 'string' ? new Date(date) : date
  return format(d, 'dd/MM/yyyy')
}

export const isPast = (time) => {
  if (!time) return false
  const d = typeof time === 'string' ? parseISO(time) : time
  return isAfter(new Date(), d)
}


// BARU: Tambahkan fungsi todayKey untuk format YYYY-MM-DD
export const todayKey = () => {
  return format(new Date(), 'yyyy-MM-dd')
}