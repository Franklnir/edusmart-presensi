import * as XLSX from 'xlsx'

export const normalizeHeader = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

export const buildAliasMap = (aliases = {}) => {
  const map = {}
  Object.entries(aliases).forEach(([field, list]) => {
    ;(list || []).forEach((alias) => {
      const key = normalizeHeader(alias)
      if (key) map[key] = field
    })
  })
  return map
}

export const mapRowByAliases = (row, aliasMap) => {
  const out = {}
  Object.entries(row || {}).forEach(([key, value]) => {
    const norm = normalizeHeader(key)
    const field = aliasMap[norm]
    if (field) out[field] = value
  })
  return out
}

const pad2 = (n) => String(n).padStart(2, '0')

export const parseDateValue = (value) => {
  if (!value) return ''

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear()
    const m = pad2(value.getMonth() + 1)
    const d = pad2(value.getDate())
    return `${y}-${m}-${d}`
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${parsed.y}-${pad2(parsed.m)}-${pad2(parsed.d)}`
    }
    const excelEpoch = new Date(Math.round((value - 25569) * 86400 * 1000))
    if (!Number.isNaN(excelEpoch.getTime())) {
      return `${excelEpoch.getFullYear()}-${pad2(excelEpoch.getMonth() + 1)}-${pad2(excelEpoch.getDate())}`
    }
  }

  const raw = String(value).trim()
  if (!raw) return ''

  // yyyy-mm-dd or yyyy/mm/dd
  let match = raw.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/)
  if (match) {
    const [, y, m, d] = match
    return `${y}-${pad2(m)}-${pad2(d)}`
  }

  // dd-mm-yyyy or dd/mm/yyyy
  match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/)
  if (match) {
    let [, d, m, y] = match
    if (y.length === 2) y = `20${y}`
    return `${y}-${pad2(m)}-${pad2(d)}`
  }

  return ''
}

export const normalizeGender = (value) => {
  if (!value) return ''
  const s = String(value).trim().toLowerCase()
  if (['l', 'laki', 'laki-laki', 'male', 'm', 'pria'].includes(s)) return 'L'
  if (['p', 'perempuan', 'female', 'f', 'wanita'].includes(s)) return 'P'
  return String(value).trim()
}

export const toText = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') {
    const asInt = Number.isFinite(value) ? Math.trunc(value) : value
    return String(asInt)
  }
  return String(value).trim()
}

export const buildDefaultPassword = (tanggalLahir, nis) => {
  const iso = parseDateValue(tanggalLahir)
  if (iso) {
    const [y, m, d] = iso.split('-')
    const dd = pad2(d)
    const mm = pad2(m)
    const pass = `${dd}${mm}${y}`
    return pass.length >= 6 ? pass : pass.padEnd(6, '0')
  }
  const fallback = toText(nis)
  if (fallback) return fallback.length >= 6 ? fallback : fallback.padEnd(6, '0')
  return '123456'
}

export const readRowsFromFile = async (file) => {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  return rows
}

export const readRowsFromCsvText = (csvText) => {
  const workbook = XLSX.read(csvText, { type: 'string', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
}

export const readRowsFromSheetUrl = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Gagal mengambil data Google Sheets')
  const text = await res.text()
  return readRowsFromCsvText(text)
}

export const buildGoogleSheetCsvUrl = (input) => {
  const raw = String(input || '').trim()
  if (!raw) return ''

  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (!match) return ''

  const sheetId = match[1]
  const gidMatch = raw.match(/[?&]gid=(\d+)/)
  const gid = gidMatch ? gidMatch[1] : '0'

  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
}
