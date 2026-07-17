import { supabase } from '../services/storageService'

export const ABSENSI_SETTINGS_BASE_COLUMNS = 'id,kelas,tanggal,mapel,mode,updated_at,tahun_ajaran,semester'
export const ABSENSI_SETTINGS_COLUMNS = `${ABSENSI_SETTINGS_BASE_COLUMNS},allow_self_absen`

export const isMissingAllowSelfAbsenColumnError = (error) => {
  if (!error) return false
  const message = String(error.message || error.details || error.hint || '').toLowerCase()
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    message.includes('allow_self_absen')
  )
}

const withPeriodFilter = (query, periodFilter = {}) => {
  let nextQuery = query
  if (periodFilter.tahunAjaran) nextQuery = nextQuery.eq('tahun_ajaran', periodFilter.tahunAjaran)
  if (periodFilter.semester) nextQuery = nextQuery.eq('semester', periodFilter.semester)
  return nextQuery
}

const normalizeRow = (row) => (
  row
    ? {
        ...row,
        allow_self_absen: Boolean(row.allow_self_absen)
      }
    : row
)

export const fetchAbsensiSettings = async ({
  kelas,
  tanggal,
  mapel = '',
  periodFilter = {},
  single = false
}) => {
  const buildQuery = (columns) => {
    let query = supabase
      .from('absensi_settings')
      .select(columns)
      .eq('kelas', kelas)
      .eq('tanggal', tanggal)
      .order('updated_at', { ascending: false })

    if (mapel) query = query.eq('mapel', mapel)
    query = withPeriodFilter(query, periodFilter)
    if (single) query = query.limit(1)
    return query
  }

  let result = await buildQuery(ABSENSI_SETTINGS_COLUMNS)
  let usedLegacyColumns = false

  if (isMissingAllowSelfAbsenColumnError(result.error)) {
    usedLegacyColumns = true
    result = await buildQuery(ABSENSI_SETTINGS_BASE_COLUMNS)
  }

  if (result.error) {
    return { ...result, usedLegacyColumns }
  }

  if (single) {
    return {
      ...result,
      data: normalizeRow((result.data || [])[0] || null),
      usedLegacyColumns
    }
  }

  return {
    ...result,
    data: (result.data || []).map(normalizeRow),
    usedLegacyColumns
  }
}
