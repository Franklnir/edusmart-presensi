export const PROFILE_SOURCE_META = {
  import: {
    label: 'Hasil import',
    shortLabel: 'Import',
    className: 'bg-amber-100 text-amber-800 border border-amber-200',
    variant: 'warning',
  },
  admin_created: {
    label: 'Buatan admin',
    shortLabel: 'Admin',
    className: 'bg-blue-100 text-blue-800 border border-blue-200',
    variant: 'primary',
  },
  manual_registration: {
    label: 'Pendaftaran manual',
    shortLabel: 'Manual',
    className: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    variant: 'success',
  },
  unknown: {
    label: 'Asal belum tercatat',
    shortLabel: 'Belum tercatat',
    className: 'bg-gray-100 text-gray-700 border border-gray-200',
    variant: 'default',
  },
}

export function normalizeProfileSource(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_')
  if (['import', 'file', 'excel', 'spreadsheet', 'sheet', 'google_sheet', 'google_sheets'].includes(normalized)) {
    return 'import'
  }
  if (['admin', 'admin_created', 'created_by_admin', 'buatan_admin'].includes(normalized)) {
    return 'admin_created'
  }
  if (['manual', 'manual_registration', 'pendaftaran_manual', 'registrasi_manual'].includes(normalized)) {
    return 'manual_registration'
  }
  return 'unknown'
}

export function getProfileSourceMeta(value) {
  return PROFILE_SOURCE_META[normalizeProfileSource(value)] || PROFILE_SOURCE_META.unknown
}
