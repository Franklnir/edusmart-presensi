// src/pages/guru/laporan/laporanUtils.js

export const getKelasDisplayName = (kelasObj) => kelasObj?.nama || kelasObj?.id || ''

export const getNamaKelasFromList = (kelasId, kelasList) => {
  const kelas = kelasList.find((k) => k.id === kelasId)
  return getKelasDisplayName(kelas) || kelasId || '—'
}

export const normalizeKelasKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')

// Helper untuk mengambil tanggal dari ARRAY bulan yang dipilih
export const getDatesInPeriod = (year, selectedMonths) => {
  if (!selectedMonths || selectedMonths.length === 0) return []

  let allDates = []
  // Sort bulan agar urut (YYYY-MM atau 01, 02, dst)
  const sortedMonths = [...selectedMonths].sort()

  sortedMonths.forEach((monthStr) => {
    const normalized = String(monthStr || '').trim()
    const explicit = normalized.match(/^(\d{4})-(\d{2})$/)
    const calendarYear = explicit ? Number(explicit[1]) : Number(year)
    const monthValue = explicit ? explicit[2] : normalized
    const m = parseInt(monthValue, 10) - 1
    const date = new Date(calendarYear, m, 1)
    while (date.getMonth() === m) {
      const y = date.getFullYear()
      const mo = String(date.getMonth() + 1).padStart(2, '0')
      const d = String(date.getDate()).padStart(2, '0')
      allDates.push(`${y}-${mo}-${d}`)
      date.setDate(date.getDate() + 1)
    }
  })
  return allDates
}

export const isSunday = (dateString) => {
  const d = new Date(dateString)
  return d.getDay() === 0
}

export const getGrade = (v) => {
  if (v === '-' || v === null || v === undefined) return '-'
  const n = Number(v)
  if (Number.isNaN(n)) return '-'
  if (n >= 90) return 'A'
  if (n >= 80) return 'B'
  if (n >= 70) return 'C'
  if (n >= 60) return 'D'
  return 'E'
}

export const PREDIKAT_GRADE = {
  A: 'Sangat Baik',
  B: 'Baik',
  C: 'Cukup',
  D: 'Kurang',
  E: 'Sangat Kurang',
  '-': 'Belum ada data'
}

export const getPredikatLabel = (nilai) => {
  const grade = getGrade(nilai)
  return `${grade} - ${PREDIKAT_GRADE[grade] || 'Belum ada data'}`
}

export const getKetuntasanStatus = (nilai, kkm = KKM_NILAI_TUGAS) => {
  const angka = toNumberOrNull(nilai)
  if (angka == null) return 'Belum ada data'
  return angka >= kkm ? 'Tuntas' : 'Remedial'
}

export const getIntervensiStatus = ({ nilaiAkhir, skorAbsensi, persenKetuntasanMapel }) => {
  const nilai = toNumberOrNull(nilaiAkhir)
  const absensi = toNumberOrNull(skorAbsensi)
  const ketuntasan = toNumberOrNull(persenKetuntasanMapel)

  if (nilai == null) return 'Belum ada data'
  if (nilai < KKM_NILAI_TUGAS - 10 || (absensi != null && absensi < 75)) return 'Intervensi Intensif'
  if (nilai < KKM_NILAI_TUGAS || (absensi != null && absensi < 85) || (ketuntasan != null && ketuntasan < 70)) {
    return 'Perlu Pendampingan'
  }
  return 'Aman'
}

export const buildCatatanWaliOtomatis = ({ nama, nilaiAkhir, skorAbsensi, persenKetuntasanMapel }) => {
  const siswaNama = String(nama || 'Siswa')
  const statusKetuntasan = getKetuntasanStatus(nilaiAkhir)
  const statusIntervensi = getIntervensiStatus({ nilaiAkhir, skorAbsensi, persenKetuntasanMapel })
  const predikat = getPredikatLabel(nilaiAkhir)

  if (statusKetuntasan === 'Belum ada data') {
    return `${siswaNama} belum memiliki data nilai yang cukup untuk evaluasi akhir.`
  }
  if (statusIntervensi === 'Intervensi Intensif') {
    return `${siswaNama} perlu intervensi intensif: program remedial terstruktur, pendampingan belajar rutin, dan koordinasi orang tua.`
  }
  if (statusIntervensi === 'Perlu Pendampingan') {
    return `${siswaNama} perlu pendampingan berkala untuk meningkatkan konsistensi akademik/kehadiran. Predikat saat ini ${predikat}.`
  }
  return `${siswaNama} menunjukkan capaian stabil dengan predikat ${predikat}. Pertahankan disiplin dan kualitas belajar.`
}

export const hitungStatistikNilai = (values = []) => {
  const numbers = values
    .map((value) => toNumberOrNull(value))
    .filter((value) => value != null)
    .sort((a, b) => a - b)

  if (!numbers.length) {
    return {
      count: 0,
      min: null,
      max: null,
      median: null,
      mean: null
    }
  }

  const count = numbers.length
  const min = numbers[0]
  const max = numbers[count - 1]
  const mean = round2(numbers.reduce((sum, value) => sum + value, 0) / count)
  const mid = Math.floor(count / 2)
  const median = count % 2 === 0 ? round2((numbers[mid - 1] + numbers[mid]) / 2) : round2(numbers[mid])

  return { count, min, max, median, mean }
}

// HELPER WARNA: Hijau (A), Kuning (C), Merah (D/E)
export const getColorClass = (val) => {
  if (val === '-' || val === null || val === undefined || val === '') return ''

  // 1. Cek jika input adalah Huruf (Grade A, B, C, D, E)
  if (typeof val === 'string' && isNaN(Number(val))) {
    if (val === 'A')
      return 'bg-green-100 text-green-700 font-bold border border-green-200'
    if (val === 'C')
      return 'bg-yellow-100 text-yellow-800 font-bold border border-yellow-200'
    if (val === 'D' || val === 'E')
      return 'bg-red-100 text-red-700 font-bold border border-red-200'
    return 'text-gray-700' // B atau lainnya standar
  }

  // 2. Cek jika input adalah Angka (Nilai 0-100)
  const n = Number(val)
  if (n >= 90) return 'bg-green-100 text-green-700 font-bold' // A
  if (n >= 80) return 'text-gray-700' // B (Normal)
  if (n >= 70) return 'bg-yellow-100 text-yellow-800 font-bold' // C
  if (n < 70) return 'bg-red-100 text-red-700 font-bold' // D & E

  return ''
}

export const bulanList = [
  { value: '01', label: 'Januari' },
  { value: '02', label: 'Februari' },
  { value: '03', label: 'Maret' },
  { value: '04', label: 'April' },
  { value: '05', label: 'Mei' },
  { value: '06', label: 'Juni' },
  { value: '07', label: 'Juli' },
  { value: '08', label: 'Agustus' },
  { value: '09', label: 'September' },
  { value: '10', label: 'Oktober' },
  { value: '11', label: 'November' },
  { value: '12', label: 'Desember' }
]

export const KKM_NILAI_TUGAS = 75
export const REKAP_WALI_STATUS_BOBOT = {
  Hadir: 1,
  Izin: 0.8,
  Sakit: 0.8,
  Alpha: 0
}
export const RANKING_TIE_BREAK_KEYS = ['nilai_akhir', 'mapel_inti', 'absensi', 'nama']
export const RANKING_TIE_BREAK_LABELS = {
  nilai_akhir: 'Nilai akhir berbobot',
  mapel_inti: 'Nilai mapel inti',
  absensi: 'Skor absensi',
  nama: 'Nama'
}
export const DEFAULT_RANKING_POLICY = {
  weights: {
    tugas: 40,
    quiz: 40,
    absensi: 20
  },
  tieBreakOrder: ['nilai_akhir', 'mapel_inti', 'absensi', 'nama'],
  coreMapel: []
}
export const MAPEL_COMPONENT_WEIGHT_RULES = [
  { key: 'bobot_tugas_pr', label: 'Tugas/PR', min: 0, max: 100, default: 30 },
  { key: 'bobot_quiz_reguler', label: 'Quiz Reguler', min: 0, max: 100, default: 20 },
  { key: 'bobot_quiz_uts', label: 'Quiz UTS', min: 0, max: 100, default: 20 },
  { key: 'bobot_quiz_uas', label: 'Quiz UAS', min: 0, max: 100, default: 30 }
]
export const DEFAULT_MAPEL_COMPONENT_WEIGHTS = MAPEL_COMPONENT_WEIGHT_RULES.reduce((acc, item) => {
  acc[item.key] = item.default
  return acc
}, {})

export const round2 = (num) => Math.round(num * 100) / 100

export const getCellTextLength = (value) => {
  if (value === null || value === undefined) return 0
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part?.text || '').join('').length
    }
    if (value.text) return String(value.text).length
    return String(value).length
  }
  return String(value).length
}

export const autoFitWorksheetColumns = (
  worksheet,
  {
    min = 10,
    max = 60,
    padding = 2,
    hardMin = {},
    hardMax = {}
  } = {}
) => {
  worksheet.columns.forEach((column, index) => {
    const colIndex = index + 1
    let longest = 0

    column.eachCell({ includeEmpty: true }, (cell) => {
      longest = Math.max(longest, getCellTextLength(cell.value))
    })

    const columnMin = hardMin[colIndex] ?? min
    const columnMax = hardMax[colIndex] ?? max
    const calculated = Math.min(Math.max(longest + padding, columnMin), columnMax)
    const current = Number(column.width || 0)
    column.width = Math.max(current, calculated)
  })
}

export const SELECTED_ROW_CLASS =
  '!bg-sky-100 shadow-inner ring-1 ring-sky-300/70 [&>td]:!bg-sky-100 [&>td]:!text-slate-900 [&>td]:!border-sky-200'

export const buildSelectableRowClass = (isSelected, defaultClass = 'hover:bg-gray-50') =>
  `cursor-pointer transition-colors ${isSelected ? SELECTED_ROW_CLASS : defaultClass}`

export const makeLocalId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const normalizeQuizMode = (quiz) => {
  const raw = String(quiz?.mode || '').trim().toLowerCase()
  if (raw === 'regular') return 'regular'
  if (raw === 'uts') return 'uts'
  if (raw === 'uas') return 'uas'
  if (raw === 'ulangan') return 'uts'
  return quiz?.is_live ? 'uts' : 'regular'
}

export const normalizeMapelName = (value) => {
  const raw = String(value || '').trim()
  return raw || 'Tanpa Mapel'
}

export const normalizeMapelKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

export const hitungSkorAbsensiWali = (absensi = {}, totalPertemuanKelas = null) => {
  const hadir = Number(absensi.Hadir || 0)
  const izin = Number(absensi.Izin || 0)
  const sakit = Number(absensi.Sakit || 0)
  const alpha = Number(absensi.Alpha || 0)
  const totalTercatat = hadir + izin + sakit + alpha
  const targetPertemuan =
    Number.isFinite(totalPertemuanKelas) && totalPertemuanKelas > 0
      ? Math.max(totalPertemuanKelas, totalTercatat)
      : totalTercatat

  if (!targetPertemuan) {
    return {
      skorAbsensi: null,
      absensiEfektif: { Hadir: hadir, Izin: izin, Sakit: sakit, Alpha: alpha },
      totalPertemuan: 0
    }
  }

  const alphaEfektif = alpha + Math.max(0, targetPertemuan - totalTercatat)

  const totalBobot =
    hadir * REKAP_WALI_STATUS_BOBOT.Hadir +
    izin * REKAP_WALI_STATUS_BOBOT.Izin +
    sakit * REKAP_WALI_STATUS_BOBOT.Sakit +
    alphaEfektif * REKAP_WALI_STATUS_BOBOT.Alpha

  return {
    skorAbsensi: round2((totalBobot / targetPertemuan) * 100),
    absensiEfektif: {
      Hadir: hadir,
      Izin: izin,
      Sakit: sakit,
      Alpha: alphaEfektif
    },
    totalPertemuan: targetPertemuan
  }
}

export const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  if (value === '-') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  const normalized =
    typeof value === 'string'
      ? value
          .normalize('NFKC')
          .replace(/[\u200B-\u200D\uFEFF]/g, '')
          .trim()
          .replace(/\s+/g, '')
          .replace(/[^0-9,.\-+]/g, '')
      : value

  if (
    normalized === '' ||
    normalized === '-' ||
    normalized === '+' ||
    normalized === '.' ||
    normalized === ','
  ) {
    return null
  }

  let numeric = normalized
  const hasComma = numeric.includes(',')
  const hasDot = numeric.includes('.')
  if (hasComma && hasDot) {
    const lastComma = numeric.lastIndexOf(',')
    const lastDot = numeric.lastIndexOf('.')
    const decimalIndex = Math.max(lastComma, lastDot)
    const intPart = numeric.slice(0, decimalIndex).replace(/[.,]/g, '')
    const fracPart = numeric.slice(decimalIndex + 1).replace(/[.,]/g, '')
    numeric = `${intPart}.${fracPart}`
  } else if (hasComma) {
    numeric = numeric.replace(',', '.')
  }

  const dotParts = numeric.split('.')
  if (dotParts.length > 2) {
    numeric = `${dotParts.slice(0, -1).join('')}.${dotParts[dotParts.length - 1]}`
  }

  const parsed = Number(numeric)
  return Number.isFinite(parsed) ? parsed : null
}

export const parseArrayLikeValue = (value) => {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined) return []
  if (typeof value !== 'string') return []

  const trimmed = value.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // Fallback ke parser delimiter biasa
    }
  }

  return trimmed.split(/[,;\n\r]+/g).map((item) => item.trim())
}

export const normalizeWeight = (value, fallback) => {
  const parsed = toNumberOrNull(value)
  if (parsed == null || parsed < 0) return fallback
  return round2(parsed)
}

export const normalizeMapelComponentWeights = (source) => {
  const normalized = {}

  MAPEL_COMPONENT_WEIGHT_RULES.forEach((rule) => {
    const parsed = toNumberOrNull(source?.[rule.key])
    normalized[rule.key] = parsed == null ? rule.default : round2(parsed)
  })

  const total = MAPEL_COMPONENT_WEIGHT_RULES.reduce(
    (sum, rule) => sum + Number(normalized[rule.key] || 0),
    0
  )
  if (total > 100.01) {
    return { ...DEFAULT_MAPEL_COMPONENT_WEIGHTS }
  }

  return normalized
}

export const getMapelWeightValidation = (source) => {
  const normalized = {}
  const errors = []

  MAPEL_COMPONENT_WEIGHT_RULES.forEach((rule) => {
    const parsed = toNumberOrNull(source?.[rule.key])
    if (parsed == null) {
      errors.push(`${rule.label} wajib diisi`)
      normalized[rule.key] = null
      return
    }
    const value = round2(parsed)
    normalized[rule.key] = value
    if (value < rule.min || value > rule.max) {
      errors.push(`${rule.label} harus ${rule.min}% - ${rule.max}%`)
    }
  })

  const total = MAPEL_COMPONENT_WEIGHT_RULES.reduce(
    (sum, rule) => sum + Number(normalized[rule.key] || 0),
    0
  )
  if (total > 100.01) {
    errors.push('Total bobot komponen mapel tidak boleh lebih dari 100%')
  }
  const remaining = Math.max(0, round2(100 - total))

  return {
    normalized,
    total: round2(total),
    remaining,
    isValid: errors.length === 0,
    errors
  }
}

export const normalizeTieBreakToken = (value) => {
  const token = String(value || '').trim().toLowerCase()
  if (!token) return null

  if (['nilai_akhir', 'nilaiakhir', 'final_score', 'akhir'].includes(token)) {
    return 'nilai_akhir'
  }
  if (['mapel_inti', 'mapelinti', 'core_mapel', 'core'].includes(token)) {
    return 'mapel_inti'
  }
  if (['absensi', 'attendance'].includes(token)) {
    return 'absensi'
  }
  if (['nama', 'name'].includes(token)) {
    return 'nama'
  }
  return null
}

export const normalizeTieBreakOrder = (value) => {
  const raw = parseArrayLikeValue(value)
  const normalized = []

  raw.forEach((item) => {
    const token = normalizeTieBreakToken(item)
    if (token && !normalized.includes(token)) {
      normalized.push(token)
    }
  })

  RANKING_TIE_BREAK_KEYS.forEach((token) => {
    if (!normalized.includes(token)) {
      normalized.push(token)
    }
  })

  return normalized
}

export const normalizeCoreMapelList = (value) => {
  const raw = parseArrayLikeValue(value)
  const normalized = []
  raw.forEach((item) => {
    const name = String(item || '').trim()
    if (!name) return
    if (!normalized.includes(name)) {
      normalized.push(name)
    }
  })
  return normalized
}

export const normalizeRankingPolicy = (settingsRow) => {
  const fallback = DEFAULT_RANKING_POLICY
  const source = settingsRow || {}
  const nestedWeights = source.weights || {}

  const weights = {
    tugas: normalizeWeight(nestedWeights.tugas, fallback.weights.tugas),
    quiz: normalizeWeight(nestedWeights.quiz, fallback.weights.quiz),
    absensi: normalizeWeight(nestedWeights.absensi, fallback.weights.absensi)
  }

  const totalWeight = weights.tugas + weights.quiz + weights.absensi
  if (Math.abs(totalWeight - 100) > 0.01) {
    weights.tugas = fallback.weights.tugas
    weights.quiz = fallback.weights.quiz
    weights.absensi = fallback.weights.absensi
  }

  return {
    weights,
    tieBreakOrder: normalizeTieBreakOrder(source.tieBreakOrder),
    coreMapel: normalizeCoreMapelList(source.coreMapel)
  }
}

export const describeRankingPolicy = (inputPolicy) => {
  const policy = normalizeRankingPolicy(inputPolicy)
  const tieBreakLabels = policy.tieBreakOrder.map(
    (key) => RANKING_TIE_BREAK_LABELS[key] || key
  )

  return {
    ...policy,
    tieBreakLabels,
    tieBreakText: tieBreakLabels.join(' -> '),
    coreMapelText: policy.coreMapel.length ? policy.coreMapel.join(', ') : 'Tidak diatur'
  }
}

export const toDateOrNull = (value) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

export const formatMiniDate = (value) => {
  const date = toDateOrNull(value)
  if (!date) return '-'
  return date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  })
}

export const hitungRataSederhana = (values = []) => {
  const numbers = values
    .map((value) => toNumberOrNull(value))
    .filter((value) => value != null)
  if (!numbers.length) return null
  const total = numbers.reduce((sum, value) => sum + value, 0)
  return round2(total / numbers.length)
}

export const hitungRataBerbobot = (components = []) => {
  let totalNilaiBobot = 0
  let totalBobot = 0

  components.forEach((component) => {
    const nilai = toNumberOrNull(component?.nilai)
    const bobot = toNumberOrNull(component?.bobot)
    if (nilai == null || bobot == null || bobot <= 0) return
    totalNilaiBobot += nilai * bobot
    totalBobot += bobot
  })

  if (!totalBobot) return null
  return round2(totalNilaiBobot / totalBobot)
}

export const hitungNilaiMapelBerbobot = ({
  rataTugasMapel,
  rataQuizRegulerMapel,
  rataQuizUtsMapel,
  rataQuizUasMapel,
  bobotMapel
}) => {
  const activeBobotMapel = normalizeMapelComponentWeights(bobotMapel)
  return hitungRataBerbobot([
    { nilai: rataTugasMapel, bobot: activeBobotMapel.bobot_tugas_pr },
    { nilai: rataQuizRegulerMapel, bobot: activeBobotMapel.bobot_quiz_reguler },
    { nilai: rataQuizUtsMapel, bobot: activeBobotMapel.bobot_quiz_uts },
    { nilai: rataQuizUasMapel, bobot: activeBobotMapel.bobot_quiz_uas }
  ])
}

export const hitungRataAkhirWali = (rataAkademik, skorAbsensi, rankingPolicy) => {
  const policy = normalizeRankingPolicy(rankingPolicy)
  const nilaiAkademik = toNumberOrNull(rataAkademik)
  if (nilaiAkademik == null) {
    return null
  }

  return hitungRataBerbobot([
    {
      nilai: nilaiAkademik,
      bobot: policy.weights.tugas + policy.weights.quiz
    },
    { nilai: skorAbsensi, bobot: policy.weights.absensi }
  ])
}

export const compareNumberDescNullLast = (a, b) => {
  const av = toNumberOrNull(a)
  const bv = toNumberOrNull(b)
  if (av == null && bv == null) return 0
  if (av == null) return 1
  if (bv == null) return -1
  if (bv !== av) return bv - av
  return 0
}

export const getRankMetricValue = (row, key) => {
  if (key === 'nilai_akhir') {
    return toNumberOrNull(row?.nilaiAkhir ?? row?.rataRata)
  }
  if (key === 'mapel_inti') {
    return toNumberOrNull(row?.nilaiMapelInti)
  }
  if (key === 'absensi') {
    return toNumberOrNull(row?.skorAbsensi)
  }
  if (key === 'nama') {
    return String(row?.nama || '')
  }
  return null
}

export const compareNamaAsc = (a, b) =>
  String(a?.nama || '').localeCompare(String(b?.nama || ''), 'id')

export const compareRankWali = (a, b, rankingPolicy = DEFAULT_RANKING_POLICY) => {
  const policy = normalizeRankingPolicy(rankingPolicy)

  for (const key of policy.tieBreakOrder) {
    if (key === 'nama') {
      const cmpNama = compareNamaAsc(a, b)
      if (cmpNama !== 0) return cmpNama
      continue
    }

    const cmpNumber = compareNumberDescNullLast(
      getRankMetricValue(a, key),
      getRankMetricValue(b, key)
    )
    if (cmpNumber !== 0) return cmpNumber
  }

  const cmpNama = compareNamaAsc(a, b)
  if (cmpNama !== 0) return cmpNama
  return String(a?.id || '').localeCompare(String(b?.id || ''), 'id')
}

export const isSameRankGroup = (a, b, rankingPolicy = DEFAULT_RANKING_POLICY) => {
  const policy = normalizeRankingPolicy(rankingPolicy)
  const groupKeys = policy.tieBreakOrder.filter((key) => key !== 'nama')

  if (!groupKeys.length) {
    return compareNamaAsc(a, b) === 0
  }

  return groupKeys.every((key) => {
    const av = getRankMetricValue(a, key)
    const bv = getRankMetricValue(b, key)
    const numA = toNumberOrNull(av)
    const numB = toNumberOrNull(bv)
    if (numA == null || numB == null) return numA == null && numB == null
    return numA === numB
  })
}

export const rankSiswaWali = (rows = [], rankingPolicy = DEFAULT_RANKING_POLICY) => {
  const sorted = [...rows].sort((a, b) => compareRankWali(a, b, rankingPolicy))
  return sorted.reduce((acc, s, idx) => {
    if (idx === 0) {
      acc.push({ ...s, rank: 1 })
      return acc
    }

    const prevSource = sorted[idx - 1]
    const prevRanked = acc[idx - 1]
    const rank = isSameRankGroup(s, prevSource, rankingPolicy) ? prevRanked.rank : idx + 1
    acc.push({ ...s, rank })
    return acc
  }, [])
}

export const isSameRankOrder = (currentRows = [], nextRows = []) => {
  if (currentRows.length !== nextRows.length) return false

  for (let idx = 0; idx < currentRows.length; idx += 1) {
    const current = currentRows[idx] || {}
    const next = nextRows[idx] || {}
    if (String(current.id || '') !== String(next.id || '')) return false
    if (Number(current.rank || 0) !== Number(next.rank || 0)) return false
  }

  return true
}

