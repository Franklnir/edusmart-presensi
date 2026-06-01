import { buildAliasMap, normalizeGender } from '../../../utils/importUtils'

export const JK_LABEL = (jk) => {
  if (!jk) return '—'
  const normalized = normalizeGender(jk)
  if (normalized === 'L') return 'Laki-laki'
  if (normalized === 'P') return 'Perempuan'
  return jk
}

export const STATUS_META = (status) => {
  const st = String(status || '').toLowerCase()
  if (st === 'active') return { key: 'active', label: 'Aktif', icon: '✅', variant: 'success' }
  if (st === 'nonaktif' || st === 'inactive') return { key: 'nonaktif', label: 'Nonaktif', icon: '⏸️', variant: 'danger' }
  if (st === 'mutasi') return { key: 'mutasi', label: 'Mutasi', icon: '📤', variant: 'info' }
  if (st === 'alumni') return { key: 'alumni', label: 'Alumni', icon: '🎓', variant: 'primary' }
  if (!st) return { key: '', label: '—', icon: '', variant: 'default' }
  return { key: st, label: status, icon: '•', variant: 'default' }
}

const GRADE_REGEX = /^\s*(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I|\d+)/i

export function getGradeRaw(kelasId = '') {
  const match = String(kelasId || '').toUpperCase().match(GRADE_REGEX)
  return match ? match[1] : ''
}

const NUM2ROMAN = {
  '1': 'I',
  '2': 'II',
  '3': 'III',
  '4': 'IV',
  '5': 'V',
  '6': 'VI',
  '7': 'VII',
  '8': 'VIII',
  '9': 'IX',
  '10': 'X',
  '11': 'XI',
  '12': 'XII',
}

export function canonGrade(value) {
  if (!value) return ''
  const normalized = String(value).toUpperCase().trim()
  if (/^\d+$/.test(normalized)) return NUM2ROMAN[normalized] || normalized
  return normalized
}

export function getGradeLabel(kelasId = '') {
  return canonGrade(getGradeRaw(kelasId))
}

export function getKelasDisplayName(kelasObj) {
  if (!kelasObj) return ''
  return kelasObj.nama || kelasObj.id || ''
}

export function normalizePhoneID(input) {
  if (!input) return ''
  const digits = String(input).replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('62')) return '0' + digits.slice(2)
  if (digits.startsWith('8')) return '0' + digits
  if (digits.startsWith('0')) return digits
  return digits
}

export const validatePhoneNumber = (raw, fieldName) => {
  if (!raw) return ''
  const normalized = normalizePhoneID(raw)
  if (!normalized) return ''
  if (normalized.length > 14) return `Nomor ${fieldName} maksimal 14 digit`

  const phonePattern = /^0[2-9]\d{7,11}$/
  if (!phonePattern.test(normalized)) {
    return `Format nomor ${fieldName} tidak valid. Contoh: 081234567890`
  }
  return ''
}

export const formatPhoneDisplay = (phone) => {
  if (!phone) return '—'
  const clean = normalizePhoneID(phone)
  if (!clean) return '—'

  if (clean.startsWith('0') && clean.length >= 10) {
    const p1 = clean.slice(0, 4)
    const p2 = clean.slice(4, 8)
    const p3 = clean.slice(8)
    return `${p1}-${p2}-${p3}`
  }
  return phone
}

export const formatDateInputValue = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    return raw.slice(0, 10)
  }

  return parsed.toISOString().slice(0, 10)
}

export const buildAdditionalInfoForm = (item = null) => ({
  nama: String(item?.nama || ''),
  nis: String(item?.nis || ''),
  jk: normalizeGender(item?.jk) || '',
  tanggal_lahir: formatDateInputValue(item?.tanggal_lahir),
  agama: String(item?.agama || ''),
  alamat: String(item?.alamat || ''),
})

export const SISWA_ALIAS_MAP = buildAliasMap({
  nama: ['nama', 'name', 'nama siswa', 'nama lengkap', 'full name'],
  nis: ['nis', 'nisn', 'nik', 'nip', 'noinduk', 'no induk', 'nomor induk', 'studentid'],
  kelas: ['kelas', 'class', 'rombel', 'kelas_id', 'kelas siswa', 'tingkat', 'grade'],
  jk: ['jk', 'jenis kelamin', 'gender', 'kelamin', 'sex'],
  tanggal_lahir: ['tanggal lahir', 'tgl lahir', 'tgl_lahir', 'dob', 'birthdate'],
  agama: ['agama', 'religion'],
  alamat: ['alamat', 'address', 'alamat lengkap'],
  telp: ['telp', 'telepon', 'phone', 'no hp', 'nohp', 'hp', 'wa', 'whatsapp'],
  no_hp_siswa: ['no hp siswa', 'hp siswa', 'telp siswa', 'nohp siswa'],
  no_hp_wali: ['no hp wali', 'hp wali', 'telp wali', 'nohp wali'],
  email: ['email', 'email siswa'],
  status: ['status'],
})

export const normalizeKelasKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

export const slugifyKelas = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')

export const normalizeStatusValue = (value) => {
  if (!value) return ''
  const status = String(value).trim().toLowerCase()
  if (['aktif', 'active'].includes(status)) return 'active'
  if (['nonaktif', 'inactive'].includes(status)) return 'nonaktif'
  if (['mutasi', 'pindah'].includes(status)) return 'mutasi'
  if (['alumni', 'lulus', 'graduate'].includes(status)) return 'alumni'
  return ''
}

export const calculateAgeFromIsoDate = (isoDate) => {
  const raw = String(isoDate || '').trim()
  if (!raw) return null

  const parts = raw.split('-')
  if (parts.length !== 3) return null

  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  const today = new Date()
  let age = today.getFullYear() - year
  const monthDiff = today.getMonth() + 1 - month
  const dayDiff = today.getDate() - day

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1
  }

  return age >= 0 ? age : null
}

export const createClientUuid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

export const IMPORT_SOURCE_LABEL = {
  file: 'Upload File',
  sheet: 'Google Sheets',
}

export const SISWA_IMPORT_EXAMPLE_COLUMNS = [
  { key: 'nama', label: 'Nama', cellClassName: 'min-w-[180px] font-medium text-gray-800 whitespace-normal leading-5' },
  { key: 'nis', label: 'NIS', cellClassName: 'min-w-[92px] whitespace-nowrap' },
  { key: 'kelas', label: 'Kelas', cellClassName: 'min-w-[112px] whitespace-normal leading-5' },
  { key: 'jk', label: 'JK', cellClassName: 'min-w-[56px] whitespace-nowrap' },
  { key: 'tanggal_lahir', label: 'Tanggal Lahir', cellClassName: 'min-w-[120px] whitespace-nowrap' },
  { key: 'agama', label: 'Agama', cellClassName: 'min-w-[92px] whitespace-nowrap' },
  { key: 'alamat', label: 'Alamat', cellClassName: 'min-w-[220px] whitespace-normal leading-5' },
  { key: 'no_hp_siswa', label: 'No HP Siswa', cellClassName: 'min-w-[136px] whitespace-nowrap' },
  { key: 'no_hp_wali', label: 'No HP Wali', cellClassName: 'min-w-[136px] whitespace-nowrap' },
]

export const SISWA_IMPORT_EXAMPLE_HEADERS = SISWA_IMPORT_EXAMPLE_COLUMNS.map((column) => column.label)
