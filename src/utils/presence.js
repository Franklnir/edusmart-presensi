import { formatDateTime } from '../lib/time'

export const isPresenceOnline = (value) =>
  value === true || value === 1 || value === '1' || value === 'true'

export const formatPresenceText = (user = {}) => {
  const online = isPresenceOnline(user.online) || Number(user.active_devices || 0) > 0
  const devices = Number(user.active_devices || 0)

  if (online) {
    return devices > 1 ? `Online sekarang (${devices} perangkat)` : 'Online sekarang'
  }

  if (user.last_seen_at) {
    return `Offline - terakhir online ${formatDateTime(user.last_seen_at)}`
  }

  return 'Belum pernah online'
}

export const presenceBadgeClassName = (user = {}) => {
  const online = isPresenceOnline(user.online) || Number(user.active_devices || 0) > 0
  return online
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-slate-50 text-slate-500 border-slate-200'
}
