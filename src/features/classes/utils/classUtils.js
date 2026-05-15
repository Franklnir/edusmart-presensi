// src/features/classes/utils/classUtils.js

export const HARI_OPTS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
export const GRADE_OPTS = ['VII', 'VIII', 'IX', 'X', 'XI', 'XII']
export const GRADE_ORDER = Object.fromEntries(GRADE_OPTS.map((g, i) => [g, i]))
export const FORBIDDEN = /[.#$[\]]/
export const DEFAULT_SCHEDULE_DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

let jsPdfPromise = null
export const loadJsPdf = async () => {
  if (!jsPdfPromise) {
    jsPdfPromise = import('jspdf')
  }
  const mod = await jsPdfPromise
  return mod.jsPDF || mod.default
}

let autoTablePromise = null
export const loadAutoTable = async () => {
  if (!autoTablePromise) {
    autoTablePromise = import('jspdf-autotable')
  }
  const mod = await autoTablePromise
  return mod.default || mod.autoTable || null
}

export const slug = (s = '') => s.toString().trim().toLowerCase()
  .replace(/[^\w\s-]/g, '')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .slice(0, 80)

export const toMinutes = (hhmm) => {
  const value = toTimeHHMM(hhmm)
  if (!value) return NaN
  const [h, m] = value.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN
  return (h * 60) + m
}

export const toTimeHHMM = (hhmm) => {
  const value = String(hhmm || '').trim()
  if (!value) return ''
  const normalized = value.replace('.', ':')
  const match = normalized.match(/^(\d{1,2}):(\d{1,2})/)
  if (!match) return normalized.length >= 5 ? normalized.slice(0, 5) : normalized
  const hour = Math.max(0, Math.min(23, Number(match[1])))
  const minute = Math.max(0, Math.min(59, Number(match[2])))
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export const toTimeLabel = (hhmm) => toTimeHHMM(hhmm).replace(':', '.')

export const toRangeLabel = (start, end) => `${toTimeLabel(start)}-${toTimeLabel(end)}`

export const normalizeMapelInput = (value = '') => String(value || '').toUpperCase()

export const normalizeMapelName = (value = '') =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()

export const normalizeScheduleDay = (day) => {
  const raw = String(day || '').trim().toLowerCase()
  const map = {
    senin: 'Senin',
    monday: 'Senin',
    selasa: 'Selasa',
    tuesday: 'Selasa',
    rabu: 'Rabu',
    wednesday: 'Rabu',
    kamis: 'Kamis',
    thursday: 'Kamis',
    jumat: 'Jumat',
    friday: 'Jumat',
    sabtu: 'Sabtu',
    saturday: 'Sabtu',
    minggu: 'Minggu',
    sunday: 'Minggu'
  }

  return map[raw] || String(day || '').trim()
}

export const classSlug = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'kelas'

export const buildSheetName = (source = '', used = new Set()) => {
  const base = String(source || 'Jadwal')
    .replace(/[:\\/?*\[\]]/g, ' ')
    .trim() || 'Jadwal'
  const candidate = base.slice(0, 31)
  if (!used.has(candidate)) {
    used.add(candidate)
    return candidate
  }

  let i = 2
  while (i < 999) {
    const suffix = ` (${i})`
    const next = `${base.slice(0, Math.max(0, 31 - suffix.length))}${suffix}`
    if (!used.has(next)) {
      used.add(next)
      return next
    }
    i += 1
  }

  return `Sheet-${Date.now()}`
}

export const normalizeScheduleCellEntries = (entries = []) =>
  (entries || [])
    .map((item) => ({
      mapel: String(item?.mapel || '').trim(),
      guruNama: String(item?.guruNama || '').trim()
    }))
    .filter((item) => item.mapel || item.guruNama)

export const buildScheduleCellExportText = (entries = []) =>
  entries
    .map((item) => {
      const mapel = item.mapel || '-'
      return item.guruNama ? `${mapel}\n${item.guruNama}` : mapel
    })
    .join('\n\n')

export const buildScheduleCellExcelValue = (entries = []) => {
  const richText = []

  entries.forEach((item, index) => {
    if (index > 0) richText.push({ text: '\n\n' })
    richText.push({
      text: item.mapel || '-',
      font: { size: 10, bold: true, color: { argb: 'FF111827' } }
    })
    if (item.guruNama) {
      richText.push({
        text: `\n${item.guruNama}`,
        font: { size: 8, italic: true, color: { argb: 'FF4B5563' } }
      })
    }
  })

  return richText.length > 0 ? { richText } : ''
}

export const buildScheduleMatrix = (rows = [], days = DEFAULT_SCHEDULE_DAYS) => {
  const slotMap = new Map()

  ;(rows || []).forEach((row) => {
    const start = toTimeHHMM(row.jamMulai)
    const end = toTimeHHMM(row.jamSelesai)
    if (!start || !end) return
    const key = `${start}-${end}`

    if (!slotMap.has(key)) {
      const cells = {}
      days.forEach((day) => {
        cells[day] = []
      })
      slotMap.set(key, { key, start, end, cells })
    }

    const slot = slotMap.get(key)
    const day = normalizeScheduleDay(row.hari)
    if (!slot.cells[day]) {
      slot.cells[day] = []
    }

    slot.cells[day].push({
      mapel: String(row.mapel || '').trim(),
      guruNama: String(row.guruNama || '').trim()
    })
  })

  const sortedSlots = Array.from(slotMap.values()).sort((a, b) => toMinutes(a.start) - toMinutes(b.start))

  return sortedSlots.map((slot, index) => {
    const cellEntries = {}
    const cellText = {}
    days.forEach((day) => {
      const entries = normalizeScheduleCellEntries(slot.cells[day] || [])
      cellEntries[day] = entries
      cellText[day] = buildScheduleCellExportText(entries)
    })

    const isBreakRow = days.some((day) =>
      (cellEntries[day] || []).some((item) => /istirahat/i.test(item.mapel || ''))
    )
    return {
      ...slot,
      jamKe: index + 1,
      rangeLabel: toRangeLabel(slot.start, slot.end),
      cellEntries,
      cellText,
      isBreakRow
    }
  })
}

export const timesOverlap = (aStart, aEnd, bStart, bEnd) => {
  const as = toMinutes(aStart), ae = toMinutes(aEnd)
  const bs = toMinutes(bStart), be = toMinutes(bEnd)
  if ([as, ae, bs, be].some(Number.isNaN)) return false
  return as < be && bs < ae
}

export const GRADE_REGEX = /^\s*(VII|VIII|IX|X|XI|XII)\b/i
export const parseGrade = (name = '') => {
  const m = String(name || '').toUpperCase().match(GRADE_REGEX)
  return m ? m[1] : ''
}

export const stripGradePrefix = (name = '') => {
  const g = parseGrade(name)
  if (!g) return name.trim()
  return name.toUpperCase().startsWith(g) ? name.slice(g.length).trim() : name.trim()
}

export const makeClassName = (grade, suffix) => (grade + (suffix ? ' ' + suffix.trim() : '')).trim()

export const normalizeClassSuffixInput = (value = '', grade = '') => {
  const selectedGrade = String(grade || '').toUpperCase().trim()
  let suffix = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')

  if (selectedGrade) {
    suffix = suffix.replace(new RegExp(`^${selectedGrade}\\b\\s*`, 'i'), '')
  }

  return suffix.trim()
}

