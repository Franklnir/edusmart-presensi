export const BACKUP_DAY_LEGEND = [
  { status: 'backed_up', label: 'Sudah dibackup' },
  { status: 'verified_empty', label: 'Tidak ada aktivitas' },
  { status: 'new_data', label: 'Ada data baru' },
  { status: 'empty', label: 'Belum ada data backup' },
  { status: 'future', label: 'Belum berjalan' }
]

const DAY_STATUS_STYLES = {
  backed_up: 'bg-emerald-600 text-white shadow-sm',
  verified_empty: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
  new_data: 'bg-blue-600 text-white shadow-sm',
  failed: 'bg-rose-600 text-white shadow-sm',
  needs_attention: 'bg-rose-600 text-white shadow-sm',
  empty: 'border border-slate-200 bg-white text-slate-400',
  future: 'border border-dashed border-slate-300 bg-slate-50 text-slate-400'
}

const DAY_STATUS_LABELS = {
  backed_up: 'Sudah dibackup',
  verified_empty: 'Tidak ada aktivitas',
  new_data: 'Ada data baru',
  failed: 'Gagal dibackup',
  needs_attention: 'Perlu perhatian',
  empty: 'Belum ada data backup',
  future: 'Tanggal belum berjalan'
}

export const backupDayStatusStyle = (status) => DAY_STATUS_STYLES[status] || DAY_STATUS_STYLES.empty

export const backupDayStatusLabel = (status) => DAY_STATUS_LABELS[status] || DAY_STATUS_LABELS.empty

export const backupMonthVisual = (month = {}) => {
  const backedUp = Boolean(month?.is_backed_up)
  const needsUpdate = month?.status === 'needs_update' || Boolean(month?.has_new_data)
  const isFuture = month?.status === 'future'
  const needsAttention = ['failed', 'needs_attention'].includes(String(month?.status || ''))
  const file = month?.drive_file || null

  if (needsAttention) {
    return {
      tone: 'danger',
      cardClass: 'border-rose-200 bg-rose-50 text-rose-950',
      badgeClass: 'bg-rose-100 text-rose-700',
      badgeText: 'Perlu cek',
      helperText: 'Backup perlu perhatian'
    }
  }

  if (needsUpdate) {
    return {
      tone: 'changed',
      cardClass: 'border-blue-200 bg-blue-50 text-blue-950',
      badgeClass: 'bg-blue-100 text-blue-800',
      badgeText: 'Data baru',
      helperText: 'Ada data baru'
    }
  }

  if (backedUp) {
    return {
      tone: 'done',
      cardClass: 'border-emerald-200 bg-emerald-50 text-emerald-950',
      badgeClass: 'bg-emerald-100 text-emerald-800',
      badgeText: 'Sudah',
      helperText: file?.size_label || 'Tersimpan'
    }
  }

  if (isFuture) {
    return {
      tone: 'future',
      cardClass: 'border-slate-200 bg-slate-50 text-slate-500',
      badgeClass: 'bg-white text-slate-500 ring-1 ring-slate-200',
      badgeText: 'Nanti',
      helperText: 'Belum berjalan'
    }
  }

  return {
    tone: 'pending',
    cardClass: 'border-slate-200 bg-white text-slate-800',
    badgeClass: 'bg-slate-100 text-slate-600',
    badgeText: 'Belum',
    helperText: 'Belum backup'
  }
}
