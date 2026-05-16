import React, { startTransition, useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { queryClient, queryKeys } from '../../lib/queryClient'
import { formatDate } from '../../lib/time'
import { useUIStore } from '../../store/useUIStore'
import ProfileAvatar from '../../components/ProfileAvatar'
import PasswordInput from '../../components/PasswordInput'
import {
  exportRowsToExcel,
  SPREADSHEET_IMPORT_ACCEPT,
  SPREADSHEET_IMPORT_FORMAT_LABEL,
} from '../../utils/spreadsheet'
import { formatPresenceText, isPresenceOnline, presenceBadgeClassName } from '../../utils/presence'
import {
  buildAliasMap,
  mapRowByAliases,
  parseDateValue,
  normalizeGender,
  toText,
  buildDefaultPassword,
  readRowsFromFile,
  readRowsFromSheetUrl,
  buildGoogleSheetCsvUrl
} from '../../utils/importUtils'
import { isEmailFormat } from '../../utils/accountSetup'
import { getProfileSourceMeta } from '../../utils/profileSource'

const STRONG_PASSWORD_MESSAGE = 'Password minimal 12 karakter dan wajib ada huruf besar, huruf kecil, angka, serta simbol'
const isStrongPassword = (value = '') =>
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/.test(value)

/* ===== Password Modal Component ===== */
function PasswordModal({ isOpen, onClose, onConfirm, title = "Konfirmasi Password", loading = false }) {
  const [password, setPassword] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (password.trim()) {
      onConfirm(password)
      setPassword('')
    }
  }

  const handleClose = () => {
    setPassword('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70] backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600 text-sm mb-4">
          Untuk melanjutkan, masukkan password Anda:
        </p>

        <form onSubmit={handleSubmit}>
          <PasswordInput
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-4"
            placeholder="Masukkan password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors duration-200"
              onClick={handleClose}
              disabled={loading}
            >
              Batal
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || !password.trim()}
            >
              {loading ? 'Memverifikasi...' : 'Konfirmasi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ===== Password Verification Utility ===== */
const verifyPassword = async (password) => {
  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('User tidak ditemukan')
    }

    // Try to sign in with the provided password
    const { error } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: password
    })

    if (error) {
      throw new Error('Password salah')
    }

    return true
  } catch (error) {
    throw error
  }
}

/* ===== Helpers ===== */
function initials(name = '?') {
  const parts = (name || '').trim().split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('')
}

function normToArray(x) {
  if (!x) return []
  if (Array.isArray(x)) return x.map(v => String(v).trim()).filter(Boolean)
  if (typeof x === 'string') return x.split(/[,;|/]+/).map(s => s.trim()).filter(Boolean)
  if (typeof x === 'object') return Object.keys(x).map(s => String(s).trim()).filter(Boolean)
  return []
}

function listPreview(arr, max = 3) {
  const a = Array.isArray(arr) ? arr : normToArray(arr)
  if (!a.length) return { text: '—', title: '' }
  const text = a.slice(0, max).join(', ') + (a.length > max ? `, +${a.length - max}` : '')
  const title = a.join(', ')
  return { text, title }
}

// Fungsi format kelas dari slug ke display
const formatKelasDisplay = (kelasSlug) => {
  if (!kelasSlug) return '';
  const parts = kelasSlug.split('-');
  if (parts.length >= 2) {
    const grade = parts[0].toUpperCase();
    const suffix = parts[1].toUpperCase();
    return `${grade} ${suffix}`;
  }
  return parts.map(word =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ');
};

const getKelasDisplayName = (kelasObj) => {
  if (!kelasObj) return ''
  return kelasObj.nama || formatKelasDisplay(kelasObj.id) || ''
}

const normalizePhoneSimple = (input) => {
  if (!input) return ''
  return String(input).replace(/\D/g, '')
}

const normalizeKelasKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

const slugifyKelas = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')

const GURU_ALIAS_MAP = buildAliasMap({
  nama: ['nama', 'name', 'nama guru', 'nama lengkap', 'full name'],
  nis: ['nis', 'nip', 'nik', 'noinduk', 'nomor induk', 'teacherid'],
  kelas: ['kelas', 'class', 'rombel', 'kelas_id', 'kelas guru', 'tingkat', 'grade'],
  jk: ['jk', 'jenis kelamin', 'gender', 'kelamin', 'sex'],
  tanggal_lahir: ['tanggal lahir', 'tgl lahir', 'tgl_lahir', 'dob', 'birthdate'],
  agama: ['agama', 'religion'],
  alamat: ['alamat', 'address'],
  telp: ['telp', 'telepon', 'phone', 'no hp', 'nohp', 'hp', 'wa', 'whatsapp'],
  jabatan: ['jabatan', 'position', 'role'],
  email: ['email', 'email guru'],
  status: ['status']
})

const GURU_IMPORT_EXAMPLE_COLUMNS = [
  { key: 'nama', label: 'Nama', cellClassName: 'min-w-[180px] font-medium text-gray-800 whitespace-normal leading-5' },
  { key: 'nis', label: 'NIP/NUPTK', cellClassName: 'min-w-[120px] whitespace-nowrap' },
  { key: 'kelas', label: 'Kelas', cellClassName: 'min-w-[112px] whitespace-normal leading-5' },
  { key: 'jk', label: 'JK', cellClassName: 'min-w-[56px] whitespace-nowrap' },
  { key: 'tanggal_lahir', label: 'Tanggal Lahir', cellClassName: 'min-w-[120px] whitespace-nowrap' },
  { key: 'agama', label: 'Agama', cellClassName: 'min-w-[92px] whitespace-nowrap' },
  { key: 'alamat', label: 'Alamat', cellClassName: 'min-w-[220px] whitespace-normal leading-5' },
  { key: 'telp', label: 'No HP', cellClassName: 'min-w-[136px] whitespace-nowrap' },
  { key: 'jabatan', label: 'Jabatan', cellClassName: 'min-w-[156px] whitespace-normal leading-5' },
  { key: 'email', label: 'Email', cellClassName: 'min-w-[220px] whitespace-nowrap' }
]

const GURU_IMPORT_EXAMPLE_HEADERS = GURU_IMPORT_EXAMPLE_COLUMNS.map((column) => column.label)

const normalizeStatusValue = (value) => {
  if (!value) return ''
  const s = String(value).trim().toLowerCase()
  if (['aktif', 'active'].includes(s)) return 'active'
  if (['nonaktif', 'inactive'].includes(s)) return 'nonaktif'
  if (['mutasi', 'pindah'].includes(s)) return 'mutasi'
  if (['alumni', 'lulus', 'graduate'].includes(s)) return 'alumni'
  return ''
}

const getGuruStatusMeta = (value) => {
  const status = normalizeStatusValue(value) || String(value || 'active').toLowerCase() || 'active'
  if (status === 'active') return { label: 'Aktif', icon: '✅', className: 'bg-green-100 text-green-700 border border-green-200' }
  if (status === 'nonaktif') return { label: 'Nonaktif', icon: '⏸️', className: 'bg-red-100 text-red-700 border border-red-200' }
  if (status === 'mutasi') return { label: 'Mutasi', icon: '📤', className: 'bg-indigo-100 text-indigo-700 border border-indigo-200' }
  if (status === 'alumni') return { label: 'Alumni', icon: '🎓', className: 'bg-blue-100 text-blue-700 border border-blue-200' }
  return { label: status || '—', icon: '•', className: 'bg-slate-100 text-slate-700 border border-slate-200' }
}

const isGuruExitStatus = (status) => ['mutasi', 'alumni'].includes(normalizeStatusValue(status) || String(status || '').toLowerCase())

// Komponen Stat Card
const GuruStatCard = ({ label, value, icon, color = 'blue', description }) => {
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
    orange: 'bg-orange-500',
    indigo: 'bg-indigo-500',
    teal: 'bg-teal-500'
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-5 transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 mb-1">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {description && (
            <p className="text-xs text-gray-500 mt-1">{description}</p>
          )}
        </div>
        {icon && (
          <div className={`text-xl text-white p-2 rounded-lg ${colorClasses[color]}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}

// Loading Skeleton
const LoadingSkeleton = () => (
  <div className="animate-pulse">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-gray-200 rounded-lg h-20"></div>
      ))}
    </div>
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-4">
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center space-x-3">
            <div className="rounded-full bg-gray-200 h-4 w-4 ml-2"></div>
            <div className="rounded-full bg-gray-200 h-10 w-10"></div>
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
)

/* ===== Komponen UI ===== */
function Card({ children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden ${className}`}>
      {children}
    </div>
  )
}

function Badge({ children, variant = 'default', className = '' }) {
  const variants = {
    default: 'bg-gray-100 text-gray-800',
    primary: 'bg-blue-100 text-blue-800',
    success: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-indigo-100 text-indigo-800'
  }
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${variants[variant]} ${className}`}>
      {children}
    </span>
  )
}

function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  ...props
}) {
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'

  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-500 border border-gray-300',
    success: 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
    warning: 'bg-yellow-600 text-white hover:bg-yellow-700 focus:ring-yellow-500'
  }

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base'
  }

  return (
    <button
      className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
      )}
      {children}
    </button>
  )
}

function Input({ label, error, className = '', type = 'text', ...props }) {
  const inputClassName = `block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white ${className}`

  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      {type === 'password' ? (
        <PasswordInput className={inputClassName} {...props} />
      ) : (
        <input className={inputClassName} type={type} {...props} />
      )}
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  )
}

function Select({ label, error, options = [], className = '', ...props }) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <select
        className={`block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white ${className}`}
        {...props}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  )
}

export default function AGuru() {
  const { pushToast, requestConfirmation } = useUIStore()
  const [loadingInit, setLoadingInit] = useState(true)

  /* ===== Password Modal State ===== */
  const [passwordModal, setPasswordModal] = useState({
    isOpen: false,
    title: '',
    action: null,
    loading: false
  })

  const [guruRaw, setGuruRaw] = useState([])
  const [guru, setGuru] = useState([])
  const [kelasList, setKelasList] = useState([])
  const [jadwalAll, setJadwalAll] = useState({})
  const [strukturKelasAll, setStrukturKelasAll] = useState({})
  const [strukturSekolah, setStrukturSekolah] = useState({})
  const [guruMeta, setGuruMeta] = useState({
    page: 1,
    per_page: 25,
    total: 0,
    page_count: 1,
    from: 0,
    to: 0
  })
  const [guruServerStats, setGuruServerStats] = useState(null)
  const [guruFilterOptions, setGuruFilterOptions] = useState({ mapel: [], jabatan: [] })

  // Pencarian
  const [qNama, setQNama] = useState('')
  const [qMapel, setQMapel] = useState('')
  const [qJabatan, setQJabatan] = useState('')
  const [isSearching, setIsSearching] = useState(false)

  // Modal nonaktif
  const [disableUID, setDisableUID] = useState(null)
  const [alasanNonaktif, setAlasanNonaktif] = useState('')

  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [selectedGuru, setSelectedGuru] = useState(null)
  const [editNameOpen, setEditNameOpen] = useState(false)
  const [savingTeacherName, setSavingTeacherName] = useState(false)
  const [teacherNameEdit, setTeacherNameEdit] = useState({
    id: '',
    nama: '',
    currentName: '',
    email: ''
  })

  // Form tambah guru
  const [form, setForm] = useState({
    email: '',
    nama: '',
    telp: '',
    password: '',
    confirmPassword: ''
  })
  const [showAddForm, setShowAddForm] = useState(false)

  // Mutasi guru
  const [mutasiGuruOpen, setMutasiGuruOpen] = useState(false)
  const [guruToMutasi, setGuruToMutasi] = useState(null)
  const [alasanMutasiGuru, setAlasanMutasiGuru] = useState('')
  const [mutatingGuru, setMutatingGuru] = useState(false)

  // Import / Export
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importSource, setImportSource] = useState('file')
  const [importFile, setImportFile] = useState(null)
  const [sheetUrl, setSheetUrl] = useState('')
  const [importRows, setImportRows] = useState([])
  const [importErrors, setImportErrors] = useState([])
  const [importLoading, setImportLoading] = useState(false)
  const [importProgress, setImportProgress] = useState({ phase: 'idle' })
  const [importSummary, setImportSummary] = useState(null)

  const availableKelasNames = useMemo(
    () => kelasList.map((kelas) => getKelasDisplayName(kelas)).filter(Boolean),
    [kelasList]
  )

  const importExampleRows = useMemo(() => {
    const fallbackKelas = ['X A MIPA', 'X B MIPA']
    const classNames = availableKelasNames.length ? availableKelasNames : fallbackKelas
    const sampleNames = [
      'Dewi Kartika Sari',
      'Ahmad Fauzan Pratama',
      'Rina Oktaviani',
      'Bagus Ramadhan',
      'Siska Rahmawati',
      'Rizal Hidayat',
      'Lina Marlina',
      'Andika Saputra'
    ]
    const sampleJabatan = [
      'Guru Matematika',
      'Guru Bahasa Indonesia',
      'Guru IPA',
      'Guru IPS',
      'Guru Bahasa Inggris',
      'Guru BK',
      'Guru PPKn',
      'Guru Informatika'
    ]
    const sampleAgama = [
      'Islam',
      'Islam',
      'Islam',
      'Islam',
      'Islam',
      'Islam',
      'Kristen',
      'Islam'
    ]
    const sampleAddresses = [
      'Jl. Anggrek 10, Bandung',
      'Jl. Melati 21, Bandung',
      'Jl. Mawar 8, Bandung',
      'Jl. Cempaka 5, Bandung',
      'Jl. Dahlia 14, Bandung',
      'Jl. Kenanga 2, Bandung',
      'Jl. Flamboyan 12, Bandung',
      'Jl. Teratai 6, Bandung'
    ]

    return classNames.map((kelasName, index) => {
      const sampleName = sampleNames[index] || `Contoh Guru ${index + 1}`
      const emailSlug = sampleName
        .toLowerCase()
        .replace(/[^a-z\s]/g, '')
        .trim()
        .replace(/\s+/g, '.')
      const month = String((index % 12) + 1).padStart(2, '0')
      const day = String(((index * 4) % 28) + 1).padStart(2, '0')
      const nip = `1987${month}${day}${String(index + 1).padStart(4, '0')}`

      return {
        nama: sampleName,
        nis: nip,
        kelas: kelasName,
        jk: index % 2 === 0 ? 'P' : 'L',
        tanggal_lahir: `1987-${month}-${day}`,
        agama: sampleAgama[index] || 'Islam',
        alamat: sampleAddresses[index] || `Jl. Contoh ${index + 1}, Bandung`,
        telp: `08131${String(2345678 + index).padStart(7, '0')}`,
        jabatan: sampleJabatan[index] || 'Guru Mata Pelajaran',
        email: `${emailSlug || `contoh.guru.${index + 1}`}@example.com`
      }
    })
  }, [availableKelasNames])

  const getImportExampleValues = (row) => (
    GURU_IMPORT_EXAMPLE_COLUMNS.map(({ key }) => row[key] ?? '')
  )

  const importExampleCopyText = useMemo(() => {
    const headerLine = GURU_IMPORT_EXAMPLE_HEADERS.join('\t')
    const bodyLines = importExampleRows.map((row) => getImportExampleValues(row).join('\t'))

    return [headerLine, ...bodyLines].join('\n')
  }, [importExampleRows])

  const importExampleExcelRows = useMemo(() => {
    return importExampleRows.map((row) => {
      const item = {}
      GURU_IMPORT_EXAMPLE_COLUMNS.forEach(({ key, label }) => {
        item[label] = row[key] ?? ''
      })
      return item
    })
  }, [importExampleRows])

  const importMissingKelasErrors = useMemo(
    () => importErrors.filter((item) => item.type === 'kelas_missing'),
    [importErrors]
  )

  const importBlockingErrorMessage = useMemo(() => {
    if (!importErrors.length) return ''

    if (importMissingKelasErrors.length) {
      const missingNames = [
        ...new Set(importMissingKelasErrors.map((item) => item.className).filter(Boolean))
      ]
      const suffix = missingNames.length ? ` Kelas yang belum tersedia: ${missingNames.join(', ')}.` : ''
      return `Maaf, kelas data guru yang ada di file Excel, CSV, atau Google Sheets belum tersedia di website ini. Silakan buat terlebih dahulu.${suffix}`
    }

    return 'Masih ada data import guru yang belum valid. Perbaiki dulu semua error sebelum memulai import.'
  }, [importErrors, importMissingKelasErrors])

  const importedKelasNames = useMemo(
    () =>
      [
        ...new Set(
          importRows
            .map((row) => {
              const kelas = kelasList.find((item) => item.id === row.kelas)
              return getKelasDisplayName(kelas) || row.kelas_raw || row.kelas
            })
            .filter(Boolean)
        )
      ],
    [importRows, kelasList]
  )

  const importCanRun = Boolean(importRows.length && kelasList.length && !importLoading)
  const importButtonText = importLoading
    ? 'Memproses...'
    : importErrors.length > 0 && importRows.length > 0
      ? 'Import Data Valid'
      : 'Mulai Import'
  const importButtonHint = !kelasList.length
    ? 'Buat kelas terlebih dahulu sebelum import.'
    : !importRows.length && importErrors.length > 0
      ? 'Belum ada baris valid. Perbaiki error yang tampil dulu.'
      : !importRows.length
        ? 'Upload file atau ambil data Google Sheets terlebih dahulu.'
        : importErrors.length > 0
          ? `${importRows.length} baris valid bisa diimport, ${importErrors.length} baris error akan dilewati.`
          : ''
  const importProgressTotal = Math.max(Number(importProgress.total || 0), 0)
  const importProgressCurrent = Math.min(
    Math.max(Number(importProgress.current || 0), 0),
    importProgressTotal || 0
  )
  const importProgressPercent = importProgressTotal > 0
    ? Math.min(100, Math.round((importProgressCurrent / importProgressTotal) * 100))
    : importProgress.phase === 'done'
      ? 100
      : 0
  const importProgressSteps = [
    ['reading', 'Baca file'],
    ['ready', 'Validasi'],
    ['processing', 'Import'],
    ['history', 'Finalisasi'],
    ['done', 'Selesai']
  ]
  const importActiveStepIndex = Math.max(
    0,
    importProgressSteps.findIndex(([key]) => key === importProgress.phase)
  )
  const showImportProgress = importLoading || ['reading', 'ready', 'processing', 'history', 'done'].includes(importProgress.phase)

  /* ===== Password Modal Functions ===== */
  const openPasswordModal = (title, action) => {
    setPasswordModal({
      isOpen: true,
      title,
      action,
      loading: false
    })
  }

  const handlePasswordConfirm = async (password) => {
    setPasswordModal(prev => ({ ...prev, loading: true }))

    try {
      await verifyPassword(password)
      await passwordModal.action()
      setPasswordModal({ isOpen: false, title: '', action: null, loading: false })
    } catch (error) {
      console.error('Password verification failed:', error)
      pushToast('error', error.message || 'Password salah')
      setPasswordModal(prev => ({ ...prev, loading: false }))
    }
  }

  const closePasswordModal = () => {
    setPasswordModal({ isOpen: false, title: '', action: null, loading: false })
  }

  // Load data
  useEffect(() => {
    loadAllData()
  }, [])

  const loadAllData = async (page = guruMeta.page || 1, overrides = {}) => {
    const isInitialLoad = !guruRaw.length && !guruMeta.total
    try {
      if (isInitialLoad) setLoadingInit(true)
      const teacherParams = {
        page,
        per_page: 25,
        q: overrides.qNama ?? qNama,
        mapel: overrides.qMapel ?? qMapel,
        jabatan: overrides.qJabatan ?? qJabatan
      }

      const [teachersRes, kelasRes] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: queryKeys.admin.teachers(teacherParams),
          queryFn: async () => {
            const { data, error } = await supabase.admin.teachers(teacherParams)
            if (error?.code === 'REQUEST_ABORTED') {
              const aborted = new Error('Request aborted')
              aborted.code = 'REQUEST_ABORTED'
              throw aborted
            }
            if (error) throw error
            return data
          },
          staleTime: 10 * 1000,
        }),
        queryClient.fetchQuery({
          queryKey: ['admin', 'teacher-page', 'classes'],
          queryFn: async () => {
            const { data, error } = await supabase
              .from('kelas')
              .select('id, nama, grade, suffix')
              .order('grade', { ascending: true })
              .order('suffix', { ascending: true })
            if (error?.code === 'REQUEST_ABORTED') {
              const aborted = new Error('Request aborted')
              aborted.code = 'REQUEST_ABORTED'
              throw aborted
            }
            if (error) throw error
            return data || []
          },
          staleTime: 5 * 60 * 1000,
        })
      ])

      startTransition(() => {
        setGuruRaw(teachersRes?.rows || [])
        setKelasList(kelasRes || [])
        setJadwalAll({})
        setStrukturKelasAll({})
        setStrukturSekolah({})
        setGuruMeta(teachersRes?.meta || {
          page: 1,
          per_page: 25,
          total: teachersRes?.rows?.length || 0,
          page_count: 1,
          from: teachersRes?.rows?.length ? 1 : 0,
          to: teachersRes?.rows?.length || 0
        })
        setGuruServerStats(teachersRes?.stats || null)
        setGuruFilterOptions(teachersRes?.filter_options || { mapel: [], jabatan: [] })
      })
    } catch (error) {
      if (error?.code === 'REQUEST_ABORTED') return
      console.error('Error loading data:', error)
      pushToast('error', 'Gagal memuat data')
    } finally {
      if (isInitialLoad) setLoadingInit(false)
    }
  }

  const loadGuruRaw = async () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'teachers'] })
    await loadAllData()
  }

  const loadKelasList = async () => {
    const { data, error } = await supabase
      .from('kelas')
      .select('id, nama, grade, suffix')
      .order('grade', { ascending: true })
      .order('suffix', { ascending: true })

    if (error) throw error
    setKelasList(data || [])
  }

  const loadJadwalAll = async () => {
    const { data, error } = await supabase
      .from('jadwal')
      .select('*')

    if (error) throw error

    const jadwalByKelas = {}
    data?.forEach(j => {
      if (!jadwalByKelas[j.kelas_id]) jadwalByKelas[j.kelas_id] = {}
      jadwalByKelas[j.kelas_id][j.id] = j
    })
    setJadwalAll(jadwalByKelas)
  }

  const loadStrukturKelasAll = async () => {
    const { data, error } = await supabase
      .from('kelas_struktur')
      .select('*')

    if (error) throw error

    const strukturByKelas = {}
    data?.forEach(s => {
      strukturByKelas[s.kelas_id] = s
    })
    setStrukturKelasAll(strukturByKelas)
  }

  const loadStrukturSekolah = async () => {
    const { data, error } = await supabase
      .from('struktur_sekolah')
      .select('*')

    if (error) throw error

    const strukturById = {}
    data?.forEach(s => {
      strukturById[s.id] = s
    })
    setStrukturSekolah(strukturById)
  }

  // Process guru data
  const guruProcessed = useMemo(() => {
    return guruRaw.map(g => {
      const mapelSet = new Set(g.mapelList || [])
      const kelasSet = new Set(g.kelasList || [])
      const jabatanSet = new Set(g.jabatanList || [])

      // Tambahkan jabatan dari profil jika ada
      if (g.jabatan) {
        jabatanSet.add(String(g.jabatan).trim())
      }

      // Cari mapel dan kelas dari jadwal
      Object.entries(jadwalAll).forEach(([kelasId, jadwalEntries]) => {
        Object.values(jadwalEntries || {}).forEach(j => {
          if (j.guru_id === g.id) {
            if (j.mapel) mapelSet.add(j.mapel)
            kelasSet.add(formatKelasDisplay(kelasId))
          }
        })
      })

      // Cari jabatan wali kelas
      Object.entries(strukturKelasAll).forEach(([kelasId, struktur]) => {
        if (struktur?.wali_guru_id === g.id) {
          jabatanSet.add(`Wali Kelas ${formatKelasDisplay(kelasId)}`)
        }
      })

      // Cari jabatan struktur sekolah
      Object.values(strukturSekolah || {}).forEach(posisi => {
        if (posisi?.guru_id === g.id) {
          if (posisi.jabatan) jabatanSet.add(posisi.jabatan)
        }
      })

      const jabatanList = Array.from(jabatanSet).sort()

      return {
        ...g,
        uid: g.id,
        mapelList: Array.from(mapelSet).sort(),
        kelasList: Array.from(kelasSet).sort(),
        jabatanList: jabatanList,
        jabatanUtama: jabatanList.length > 0 ? jabatanList[0] : '—',
        status: g.status || 'active',
        alasanNonaktif: g.alasan_nonaktif || '',
        kelasDisplay: formatKelasDisplay(g.kelas)
      }
    })
  }, [guruRaw, jadwalAll, strukturKelasAll, strukturSekolah])

  // Jabatan list untuk filter
  const jabatanList = useMemo(() => {
    if (guruFilterOptions.jabatan?.length) {
      return [...guruFilterOptions.jabatan].sort()
    }

    const jabatanSet = new Set()

    Object.values(strukturSekolah || {}).forEach(posisi => {
      if (posisi?.jabatan) {
        jabatanSet.add(posisi.jabatan)
      }
    })

    Object.keys(strukturKelasAll || {}).forEach(kelasId => {
      jabatanSet.add(`Wali Kelas ${formatKelasDisplay(kelasId)}`)
    })

    guruRaw.forEach(g => {
      if (g.jabatan) {
        jabatanSet.add(String(g.jabatan).trim())
      }
    })

    return Array.from(jabatanSet).sort()
  }, [strukturSekolah, strukturKelasAll, guruRaw, guruFilterOptions.jabatan])

  // Mapel list untuk filter
  const allMapelList = useMemo(() => {
    if (guruFilterOptions.mapel?.length) {
      return [...guruFilterOptions.mapel].sort()
    }

    const mapelSet = new Set()
    guruProcessed.forEach(g => {
      g.mapelList.forEach(mapel => mapelSet.add(mapel))
    })
    return Array.from(mapelSet).sort()
  }, [guruProcessed, guruFilterOptions.mapel])

  // Kelas list untuk filter
  const allKelasList = useMemo(() => {
    const kelasSet = new Set()
    guruProcessed.forEach(g => {
      g.kelasList.forEach(kelas => kelasSet.add(kelas))
    })
    return Array.from(kelasSet).sort()
  }, [guruProcessed])

  const kelasLookup = useMemo(() => {
    const map = new Map()
    kelasList.forEach((kelas) => {
      const keys = [
        kelas.id,
        kelas.nama,
        `${kelas.grade || ''} ${kelas.suffix || ''}`.trim(),
        `${kelas.grade || ''}${kelas.suffix || ''}`.trim(),
        `${kelas.grade || ''}-${kelas.suffix || ''}`.trim()
      ]
        .filter(Boolean)
        .map(normalizeKelasKey)

      keys.forEach((key) => {
        if (key) map.set(key, kelas.id)
      })
    })
    return map
  }, [kelasList])

  const resolveKelasId = (value) => {
    if (!value) return ''
    const key = normalizeKelasKey(value)
    if (kelasLookup.has(key)) return kelasLookup.get(key)

    const slug = slugifyKelas(value)
    const slugKey = normalizeKelasKey(slug)
    return kelasLookup.get(slugKey) || ''
  }

  const ensureKelasReadyForImport = () => {
    if (kelasList.length) return true
    pushToast('error', 'Anda belum membuat kelas. Buat kelas terlebih dahulu sebelum import data guru.')
    return false
  }

  const copyImportExampleToClipboard = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      pushToast('error', 'Browser ini belum mendukung fitur salin otomatis.')
      return
    }

    try {
      await navigator.clipboard.writeText(importExampleCopyText)
      pushToast('success', 'Contoh format import guru berhasil disalin untuk Excel atau Google Sheets.')
    } catch (error) {
      pushToast('error', error?.message || 'Gagal menyalin contoh format import guru.')
    }
  }

  const downloadImportTemplateExcel = async () => {
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      const suffix = availableKelasNames.length
        ? `${availableKelasNames.length}-kelas`
        : 'template-default'
      const fileName = `template_import_guru_${suffix}_${stamp}.xlsx`

      await exportRowsToExcel({
        rows: importExampleExcelRows,
        fileName,
        sheetName: 'Template Import Guru'
      })

      pushToast('success', `Template Excel guru berhasil diunduh: ${fileName}`)
    } catch (error) {
      pushToast('error', error?.message || 'Gagal mengunduh template Excel guru.')
    }
  }

  const normalizeImportRow = (row, index) => {
    const mapped = mapRowByAliases(row, GURU_ALIAS_MAP)
    const hasAny = Object.values(mapped).some((v) => String(v || '').trim() !== '')
    if (!hasAny) return null

    const telpRaw = toText(mapped.telp)
    const kelasRaw = toText(mapped.kelas).toUpperCase()
    const resolvedKelas = resolveKelasId(kelasRaw)

    return {
      __rowNum: index + 2,
      nama: toText(mapped.nama),
      nis: toText(mapped.nis),
      kelas: resolvedKelas,
      kelas_raw: kelasRaw,
      jk: normalizeGender(mapped.jk),
      tanggal_lahir: parseDateValue(mapped.tanggal_lahir),
      agama: toText(mapped.agama),
      alamat: toText(mapped.alamat),
      telp: telpRaw ? normalizePhoneSimple(telpRaw) : '',
      jabatan: toText(mapped.jabatan),
      email: toText(mapped.email).toLowerCase(),
      status: normalizeStatusValue(mapped.status)
    }
  }

  const prepareImportRows = (rawRows) => {
    const cleaned = []
    const errors = []

    rawRows.forEach((row, idx) => {
      const normalized = normalizeImportRow(row, idx)
      if (!normalized) return

      if (!normalized.nis || !normalized.nama) {
        errors.push({
          row: normalized.__rowNum,
          reason: 'NIS/NIP dan Nama wajib diisi'
        })
        return
      }

      if (!normalized.kelas_raw) {
        errors.push({
          row: normalized.__rowNum,
          reason: 'Kelas wajib diisi'
        })
        return
      }

      if (!normalized.kelas) {
        errors.push({
          row: normalized.__rowNum,
          reason: `Maaf, kelas "${normalized.kelas_raw}" belum tersedia di website ini. Silakan buat terlebih dahulu.`,
          type: 'kelas_missing',
          className: normalized.kelas_raw
        })
        return
      }

      if (!isEmailFormat(normalized.email)) {
        errors.push({
          row: normalized.__rowNum,
          reason: 'Email guru wajib diisi dan harus valid'
        })
        return
      }

      cleaned.push(normalized)
    })

    setImportRows(cleaned)
    setImportErrors(errors)
    setImportSummary(null)
    setImportProgress({
      phase: 'ready',
      current: 0,
      total: cleaned.length,
      failed: errors.length,
      message: cleaned.length
        ? `${cleaned.length} baris siap diimport${errors.length ? `, ${errors.length} baris perlu diperbaiki` : ''}.`
        : 'Belum ada baris valid untuk diimport.'
    })

    return { rows: cleaned, errors }
  }

  const handleImportFileChange = async (file) => {
    if (!file) return
    if (!ensureKelasReadyForImport()) return
    setImportFile(file)
    setImportLoading(true)
    setImportProgress({
      phase: 'reading',
      current: 0,
      total: 0,
      message: `Membaca file ${file.name}...`
    })
    try {
      const rows = await readRowsFromFile(file)
      prepareImportRows(rows)
    } catch (error) {
      pushToast('error', error?.message || 'Gagal membaca file')
    } finally {
      setImportLoading(false)
    }
  }

  const handleLoadSheet = async () => {
    if (!ensureKelasReadyForImport()) return
    const csvUrl = buildGoogleSheetCsvUrl(sheetUrl)
    if (!csvUrl) {
      pushToast('error', 'Link Google Sheets tidak valid')
      return
    }

    setImportLoading(true)
    setImportProgress({
      phase: 'reading',
      current: 0,
      total: 0,
      message: 'Mengambil data Google Sheets...'
    })
    try {
      const rows = await readRowsFromSheetUrl(csvUrl)
      prepareImportRows(rows)
    } catch (error) {
      pushToast('error', error?.message || 'Gagal mengambil data Google Sheets')
    } finally {
      setImportLoading(false)
    }
  }

  const resetImportState = () => {
    setImportFile(null)
    setSheetUrl('')
    setImportRows([])
    setImportErrors([])
    setImportSummary(null)
    setImportProgress({ phase: 'idle' })
    setImportSource('file')
  }

  const upsertGuruRow = async (row) => {
    const nis = row.nis
    const nama = row.nama
    const emailLower = row.email ? row.email.toLowerCase() : ''
    const hasEmail = isEmailFormat(emailLower)
    if (!hasEmail) {
      throw new Error('Email guru wajib diisi dan harus valid')
    }
    const emailForAuth = emailLower
    const password = buildDefaultPassword(row.tanggal_lahir, nis)

    let { data: existing, error: exError } = await supabase
      .from('profiles')
      .select('id, role, email, nis, created_via')
      .eq('nis', nis)
      .maybeSingle()

    if (exError) throw exError

    if (!existing) {
      const { data: byEmail } = await supabase
        .from('profiles')
        .select('id, role, email, nis, created_via')
        .eq('email', emailLower)
        .maybeSingle()
      existing = byEmail || null
    }

    const payload = {
      updated_at: new Date().toISOString()
    }

    if (row.nama) payload.nama = row.nama
    if (row.nis) payload.nis = row.nis
    if (row.jk) payload.jk = row.jk
    if (row.kelas) payload.kelas = row.kelas
    if (row.tanggal_lahir) payload.tanggal_lahir = row.tanggal_lahir
    if (row.agama) payload.agama = row.agama
    if (row.alamat) payload.alamat = row.alamat
    if (row.telp) payload.telp = row.telp
    if (row.jabatan) payload.jabatan = row.jabatan
    if (row.status) payload.status = row.status

    if (existing?.id) {
      if (existing.role && !['guru', 'teacher'].includes(existing.role)) {
        throw new Error('NIS/NIP sudah digunakan untuk role lain')
      }

      const existingEmail = String(existing.email || '').trim().toLowerCase()
      if (!existingEmail || existingEmail !== emailLower) {
        payload.email = emailLower
      }

      const updateKeys = Object.keys(payload).filter((k) => k !== 'updated_at')
      if (!updateKeys.length && existing.created_via) return 'skipped'

      const provisionPayload = {
        id: existing.id,
        nama,
        email: emailForAuth,
        password,
        role: 'guru',
        sync_existing: true,
        created_via: 'import'
      }
      if (row.nis) provisionPayload.nis = row.nis
      if (row.kelas) provisionPayload.kelas = row.kelas
      if (row.jk) provisionPayload.jk = row.jk
      if (row.tanggal_lahir) provisionPayload.tanggal_lahir = row.tanggal_lahir
      if (row.agama) provisionPayload.agama = row.agama
      if (row.alamat) provisionPayload.alamat = row.alamat
      if (row.telp) provisionPayload.telp = row.telp
      if (row.jabatan) provisionPayload.jabatan = row.jabatan
      if (payload.status) provisionPayload.status = payload.status

      const { error } = await supabase.admin.provisionUser(provisionPayload)

      if (error) throw error
      return 'updated'
    }

    const { data: provisionData, error: provisionError } = await supabase.admin.provisionUser({
      nama,
      email: emailForAuth,
      password,
      role: 'guru',
      nis: row.nis || '',
      kelas: row.kelas || '',
      jk: row.jk || '',
      tanggal_lahir: row.tanggal_lahir || '',
      agama: row.agama || '',
      alamat: row.alamat || '',
      telp: row.telp || '',
      jabatan: row.jabatan || '',
      status: payload.status || 'active',
      must_change_password: true,
      created_via: 'import'
    })

    if (provisionError) throw provisionError
    const userId = provisionData?.user?.id || provisionData?.profile?.id
    if (!userId) throw new Error('User gagal dibuat')

    return 'created'
  }

  const handleRunImport = async () => {
    if (!importRows.length) {
      pushToast('error', 'Tidak ada data untuk diimport')
      return
    }

    if (!ensureKelasReadyForImport()) {
      return
    }

    if (importErrors.length && !importRows.length) {
      pushToast('error', importBlockingErrorMessage)
      return
    }

    const kelasTersedia = importedKelasNames.length
      ? importedKelasNames.join(', ')
      : availableKelasNames.join(', ')

    const details = [
      `${importRows.length} baris valid akan diproses.`,
      `Kelas tujuan: ${kelasTersedia || '-'}.`
    ]
    if (importErrors.length) {
      details.push(`${importErrors.length} baris error akan dilewati dan dicatat sebagai gagal.`)
    }

    const confirmed = await requestConfirmation({
      title: 'Mulai import guru?',
      message: 'Sistem akan membuat atau memperbarui akun guru dari data yang sudah valid.',
      confirmText: 'Mulai Import',
      cancelText: 'Batal',
      tone: 'info',
      details
    })

    if (!confirmed) {
      return
    }

    setImportLoading(true)
    const summary = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: importErrors.length,
      errors: importErrors.map((error) => ({
        row: error.row,
        reason: error.reason
      }))
    }
    const totalRows = importRows.length
    let processedRows = 0
    setImportProgress({
      phase: 'processing',
      current: 0,
      total: totalRows,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: summary.failed,
      message: 'Memulai import data guru...'
    })

    for (const row of importRows) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await upsertGuruRow(row)
        if (result === 'created') summary.created += 1
        else if (result === 'updated') summary.updated += 1
        else summary.skipped += 1
      } catch (error) {
        summary.failed += 1
        summary.errors.push({
          row: row.__rowNum,
          reason: error?.message || 'Gagal memproses'
        })
      } finally {
        processedRows += 1
        setImportProgress({
          phase: 'processing',
          current: processedRows,
          total: totalRows,
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped,
          failed: summary.failed,
          message: `Memproses baris ${row.__rowNum}...`
        })
        if (processedRows % 5 === 0) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }
    }

    setImportSummary(summary)
    setImportProgress({
      phase: 'done',
      current: totalRows,
      total: totalRows,
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped,
      failed: summary.failed,
      message: 'Import guru selesai.'
    })
    pushToast('success', `Import guru selesai: ${summary.created} baru, ${summary.updated} update, ${summary.skipped} lewati, ${summary.failed} gagal.`)
    setImportLoading(false)
    await loadGuruRaw()
  }

  const exportGuruToExcel = async () => {
    try {
      const params = {
        page: 1,
        per_page: 10000,
        all: true,
        q: qNama,
        mapel: qMapel,
        jabatan: qJabatan
      }

      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.admin.teachers(params),
        queryFn: async () => {
          const { data, error } = await supabase.admin.teachers(params)
          if (error) throw error
          return data
        },
        staleTime: 30 * 1000,
      })

      const exportRows = data?.rows || guru
      const rows = exportRows.map((item, idx) => ({
        No: idx + 1,
        NIS: item.nis || '',
        Nama: item.nama || '',
        Email: item.email || '',
        Telp: item.telp || '',
        Jabatan: item.jabatan || item.jabatanUtama || '',
        Mapel: (item.mapelList || []).join(', '),
        Kelas: (item.kelasList || []).join(', '),
        Status: item.status || 'active',
        'Asal Data': getProfileSourceMeta(item.created_via).label
      }))

      const stamp = new Date().toISOString().slice(0, 10)
      await exportRowsToExcel({
        rows,
        sheetName: 'Guru',
        fileName: `guru_${stamp}.xlsx`
      })
    } catch (error) {
      console.error('Error exporting guru:', error)
      pushToast('error', 'Gagal mengekspor data guru')
    }
  }

  // Statistik untuk dashboard
  const stats = useMemo(() => {
    if (guruServerStats) {
      return {
        totalGuru: guruServerStats.totalGuru || 0,
        aktifGuru: guruServerStats.aktifGuru || 0,
        nonaktifGuru: guruServerStats.nonaktifGuru || 0,
        mutasiGuru: guruServerStats.mutasiGuru || 0,
        totalJabatan: guruServerStats.jabatanCount || 0
      }
    }

    const totalGuru = guruProcessed.length
    const aktifGuru = guruProcessed.filter(g => g.status === 'active').length
    const nonaktifGuru = guruProcessed.filter(g => g.status === 'nonaktif').length
    const mutasiGuru = guruProcessed.filter(g => g.status === 'mutasi').length
    const totalJabatan = jabatanList.length

    return {
      totalGuru,
      aktifGuru,
      nonaktifGuru,
      mutasiGuru,
      totalJabatan
    }
  }, [guruProcessed, jabatanList, guruServerStats])

  // Update state guru ketika data diproses
  useEffect(() => {
    setGuru(guruProcessed)
  }, [guruProcessed])

  /* ===== Filter ===== */
  function applyFilter() {
    setIsSearching(true)
    loadAllData(1, { qNama, qMapel, qJabatan })
      .finally(() => setIsSearching(false))
  }

  function resetFilter() {
    setQNama('')
    setQMapel('')
    setQJabatan('')
    loadAllData(1, { qNama: '', qMapel: '', qJabatan: '' })
  }

  /* ===== Form Handler ===== */
  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  /* ===== Tambah Guru ===== */
  const handleAdd = async () => {
    if (!form.email || !form.nama) {
      return pushToast('error', 'Email dan nama harus diisi')
    }

    if (!form.password) {
      return pushToast('error', 'Password harus diisi')
    }

    if (form.password !== form.confirmPassword) {
      return pushToast('error', 'Password dan konfirmasi password tidak sama')
    }

    if (!isStrongPassword(form.password)) {
      return pushToast('error', STRONG_PASSWORD_MESSAGE)
    }

    try {
      const { error } = await supabase.admin.provisionUser({
        email: form.email.trim().toLowerCase(),
        nama: form.nama.trim(),
        telp: form.telp.trim(),
        password: form.password,
        role: 'guru',
        status: 'active',
        must_change_password: true,
        created_via: 'admin_created'
      })

      if (error) throw error

      pushToast('success', 'Guru berhasil ditambahkan. Data akun dan profil sudah sinkron.')
      setForm({
        email: '',
        nama: '',
        telp: '',
        password: '',
        confirmPassword: ''
      })
      setShowAddForm(false)
      loadGuruRaw()
    } catch (error) {
      console.error(error)
      pushToast('error', 'Gagal mendaftarkan guru: ' + (error.message || 'Unknown error'))
    }
  }

  /* ===== Status Guru ===== */
  function openNonaktif(u) {
    openPasswordModal(
      'Konfirmasi Nonaktifkan Guru',
      () => {
        setDisableUID(u.id)
        setAlasanNonaktif('')
      }
    )
  }

  const simpanNonaktif = () => {
    if (!disableUID) return

    if (!alasanNonaktif.trim()) {
      pushToast('error', 'Harap masukkan alasan penonaktifan')
      return
    }

    openPasswordModal(
      'Konfirmasi Akhir Nonaktifkan Guru',
      async () => {
        try {
          const reason = alasanNonaktif.trim()
          const { data, error } = await supabase.admin.updateUserStatus(disableUID, {
            role: 'guru',
            status: 'nonaktif',
            reason
          })
          if (error) throw error

          pushToast('success', 'Guru berhasil dinonaktifkan')
          setSelectedGuru(prev => prev?.id === disableUID ? ({
            ...prev,
            ...(data?.profile || {}),
            status: 'nonaktif',
            alasan_nonaktif: reason,
            disabled_at: data?.profile?.disabled_at || new Date().toISOString()
          }) : prev)
          setDisableUID(null)
          setAlasanNonaktif('')
          loadGuruRaw()
        } catch (error) {
          console.error('Error disabling guru:', error)
          pushToast('error', 'Gagal menonaktifkan guru')
        }
      }
    )
  }

  function batalNonaktif() {
    setDisableUID(null)
    setAlasanNonaktif('')
  }

  const aktif = (u) => {
    openPasswordModal(
      'Konfirmasi Aktifkan Guru',
      async () => {
        try {
          const { data, error } = await supabase.admin.updateUserStatus(u.id, {
            role: 'guru',
            status: 'active'
          })
          if (error) throw error

          pushToast('success', 'Guru berhasil diaktifkan')
          setSelectedGuru(prev => prev?.id === u.id ? ({
            ...prev,
            ...(data?.profile || {}),
            status: 'active',
            alasan_nonaktif: null,
            disabled_at: null
          }) : prev)
          loadGuruRaw()
        } catch (error) {
          console.error('Error activating guru:', error)
          pushToast('error', 'Gagal mengaktifkan guru')
        }
      }
    )
  }

  /* ===== Mutasi Guru ===== */
  function openMutasiGuru(guru) {
    openPasswordModal(
      'Konfirmasi Mutasi Guru',
      () => {
        setGuruToMutasi(guru)
        setAlasanMutasiGuru('')
        setMutasiGuruOpen(true)
      }
    )
  }

  function closeMutasiGuru() {
    setMutasiGuruOpen(false)
    setGuruToMutasi(null)
    setAlasanMutasiGuru('')
  }

  const simpanMutasiGuru = () => {
    if (!guruToMutasi) return
    if (!alasanMutasiGuru.trim()) {
      pushToast('error', 'Harap masukkan alasan mutasi')
      return
    }

    openPasswordModal(
      'Konfirmasi Akhir Mutasi Guru',
      async () => {
        try {
          setMutatingGuru(true)
          const reason = `Mutasi/Pindah sekolah. ${alasanMutasiGuru.trim()}`
          const { data, error } = await supabase.admin.updateUserStatus(guruToMutasi.id, {
            role: 'guru',
            status: 'mutasi',
            reason
          })
          if (error) throw error

          pushToast('success', 'Guru berhasil dimutasi. Data tetap tersimpan dan relasi aktif sudah disinkronkan.')
          setSelectedGuru(prev => prev?.id === guruToMutasi.id ? ({
            ...prev,
            ...(data?.profile || {}),
            status: 'mutasi',
            alasan_nonaktif: reason
          }) : prev)
          closeMutasiGuru()
          await loadGuruRaw()
        } catch (error) {
          console.error('Error mutasi guru:', error)
          pushToast('error', 'Gagal memutasi guru: ' + (error.message || 'Unknown error'))
        } finally {
          setMutatingGuru(false)
        }
      }
    )
  }

  /* ===== Modal Detail Guru ===== */
  function openDetailModal(guru) {
    setSelectedGuru(guru)
    setDetailModalOpen(true)
  }

  function closeDetailModal() {
    setSelectedGuru(null)
    setDetailModalOpen(false)
  }

  function openEditNameModal(guru) {
    if (!guru) return

    setTeacherNameEdit({
      id: guru.id,
      nama: guru.nama || '',
      currentName: guru.nama || '',
      email: guru.email || ''
    })
    setEditNameOpen(true)
  }

  function closeEditNameModal() {
    if (savingTeacherName) return

    setEditNameOpen(false)
    setTeacherNameEdit({
      id: '',
      nama: '',
      currentName: '',
      email: ''
    })
  }

  function applyTeacherNameUpdate(id, profile, fallbackName) {
    const nextName = profile?.nama || fallbackName
    if (!id || !nextName) return

    const mergeName = (item) => (
      item?.id === id
        ? { ...item, ...(profile || {}), nama: nextName }
        : item
    )

    setGuruRaw(prev => prev.map(mergeName))
    setGuru(prev => prev.map(mergeName))
    setSelectedGuru(prev => (prev?.id === id ? mergeName(prev) : prev))
  }

  const submitTeacherNameEdit = (event) => {
    event.preventDefault()

    const nextName = String(teacherNameEdit.nama || '').trim().replace(/\s+/g, ' ')
    const currentName = String(teacherNameEdit.currentName || '').trim().replace(/\s+/g, ' ')

    if (!teacherNameEdit.id) {
      pushToast('error', 'Guru tidak valid')
      return
    }

    if (!nextName) {
      pushToast('error', 'Nama guru wajib diisi')
      return
    }

    if (nextName.length > 120) {
      pushToast('error', 'Nama guru maksimal 120 karakter')
      return
    }

    if (nextName === currentName) {
      pushToast('info', 'Nama guru belum berubah')
      return
    }

    const target = {
      id: teacherNameEdit.id,
      nama: nextName
    }

    openPasswordModal(
      'Konfirmasi Edit Nama Guru',
      async () => {
        setSavingTeacherName(true)

        try {
          const { data, error } = await supabase.admin.updateTeacherName(target.id, target.nama)
          if (error) throw error

          applyTeacherNameUpdate(target.id, data?.profile, target.nama)
          closeEditNameModal()
          pushToast('success', 'Nama guru berhasil diperbarui')

          await loadAllData()
        } finally {
          setSavingTeacherName(false)
        }
      }
    )
  }

  // Komponen untuk menampilkan badge jabatan
  const JabatanBadge = ({ jabatanList }) => {
    if (!jabatanList || jabatanList.length === 0) {
      return <span className="text-gray-500 text-sm">—</span>
    }

    return (
      <div className="flex flex-wrap gap-1">
        {jabatanList.map((jabatan, index) => (
          <span
            key={index}
            className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200"
            title={jabatan}
          >
            {jabatan}
          </span>
        ))}
      </div>
    )
  }

  /* ===== Render ===== */
  const selectedGuruSourceMeta = getProfileSourceMeta(selectedGuru?.created_via)
  const selectedGuruStatusMeta = getGuruStatusMeta(selectedGuru?.status)
  const selectedGuruCanMutasi = selectedGuru ? !isGuruExitStatus(selectedGuru.status) : false

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-6">
      <div className="w-full space-y-8 px-4 sm:px-6 lg:px-8">
        {/* Password Modal */}
        <PasswordModal
          isOpen={passwordModal.isOpen}
          onClose={closePasswordModal}
          onConfirm={handlePasswordConfirm}
          title={passwordModal.title}
          loading={passwordModal.loading}
        />

        {importModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 sm:items-center">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Import Data Guru</h3>
                  <p className="text-sm text-gray-500">
                    Upload Excel/CSV atau Google Sheets untuk membuat akun guru otomatis.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setImportModalOpen(false)
                    resetImportState()
                  }}
                  className="text-gray-500 hover:text-gray-700 text-sm"
                >
                  ✕ Tutup
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`px-4 py-2 rounded-lg text-sm font-medium border ${importSource === 'file'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-200'
                      }`}
                    onClick={() => setImportSource('file')}
                  >
                    📁 Upload File
                  </button>
                  <button
                    type="button"
                    className={`px-4 py-2 rounded-lg text-sm font-medium border ${importSource === 'sheet'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-200'
                      }`}
                    onClick={() => setImportSource('sheet')}
                  >
                    📊 Google Sheets
                  </button>
                </div>

                <div className={`rounded-xl border p-4 text-sm ${kelasList.length
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-900'
                  : 'bg-red-50 border-red-200 text-red-800'
                  }`}>
                  <p className="font-semibold mb-1">
                    {kelasList.length ? 'Konfirmasi kelas yang sudah dibuat' : 'Import ditolak sementara'}
                  </p>
                  {kelasList.length ? (
                    <>
                      <p className="mb-3">
                        Apakah Anda yakin ingin masukin data guru dengan kelas yang sudah kita buat?
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {availableKelasNames.map((kelasName) => (
                          <span
                            key={kelasName}
                            className="inline-flex items-center rounded-full bg-white/80 px-3 py-1 text-xs font-semibold border border-indigo-200"
                          >
                            {kelasName}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p>
                      Anda belom membuat kelas, jadi upload Excel, CSV, atau Google Sheets belum bisa diproses.
                    </p>
                  )}
                </div>

                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        Contoh format {importExampleRows.length} baris
                      </p>
                      <p className="text-xs text-gray-500">
                        Satu baris contoh untuk tiap kelas yang sudah dibuat. Bisa dipakai untuk Excel, CSV, atau langsung dipaste ke Google Sheets.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={copyImportExampleToClipboard}
                        className="px-3 py-2 rounded-lg border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                      >
                        Copy Contoh
                      </button>
                      <button
                        type="button"
                        onClick={downloadImportTemplateExcel}
                        className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
                      >
                        Download Template Excel
                      </button>
                    </div>
                  </div>

                  <div className="max-h-64 overflow-auto">
                    <table className="w-full min-w-[1160px] text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          {GURU_IMPORT_EXAMPLE_COLUMNS.map((column) => (
                            <th
                              key={column.key}
                              className="px-4 py-3 text-left font-semibold text-slate-600 border-b border-gray-200 sticky top-0 bg-slate-50"
                            >
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {importExampleRows.map((row, idx) => (
                          <tr
                            key={`${row.nis}-${idx}`}
                            className={idx % 2 === 0 ? 'border-b border-gray-100 bg-white' : 'border-b border-gray-100 bg-slate-50/50'}
                          >
                            {GURU_IMPORT_EXAMPLE_COLUMNS.map((column) => (
                              <td
                                key={`${row.nis}-${column.key}`}
                                className={`px-4 py-3 align-top text-gray-700 ${column.cellClassName}`}
                              >
                                {row[column.key] || '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="border-t border-gray-200 bg-gray-50 p-4">
                    <p className="text-xs font-semibold text-gray-700 mb-2">
                      Format yang bisa dicopy ke Excel / Google Sheets:
                    </p>
                    <textarea
                      readOnly
                      value={importExampleCopyText}
                      className="w-full min-h-[130px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 font-mono"
                      spellCheck={false}
                    />
                    <p className="mt-2 text-[11px] text-gray-500">
                      Template download memakai format Excel (`.xlsx`) supaya header dan kolom terlihat lebih rapi saat dibuka.
                    </p>
                  </div>
                </div>

                {importSource === 'file' && (
                  <div className="space-y-3">
                    <input
                      type="file"
                      accept={SPREADSHEET_IMPORT_ACCEPT}
                      onChange={(e) => handleImportFileChange(e.target.files?.[0])}
                      className="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                      disabled={importLoading || !kelasList.length}
                    />
                    {importFile && (
                      <p className="text-xs text-gray-500">File terpilih: {importFile.name}</p>
                    )}
                  </div>
                )}

                {importSource === 'sheet' && (
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Tempel link Google Sheets (publik)"
                      value={sheetUrl}
                      onChange={(e) => setSheetUrl(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm"
                      disabled={importLoading || !kelasList.length}
                    />
                    <button
                      type="button"
                      onClick={handleLoadSheet}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                      disabled={importLoading || !sheetUrl.trim() || !kelasList.length}
                    >
                      Ambil Data
                    </button>
                  </div>
                )}

                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
                  <p className="font-semibold mb-1">Catatan penting</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Kolom wajib: <b>Nama</b>, <b>NIP/NUPTK</b>, <b>Email</b>, dan <b>Kelas</b>.</li>
                    <li>Kolom <b>JK</b> bisa diisi <b>L</b>/<b>P</b>, <b>Laki-laki</b>, <b>Laki laki</b>, <b>Perempuan</b>, atau <b>Perumpuan</b>.</li>
                    <li>Password awal sistem akan diamankan otomatis oleh server.</li>
                    <li>Untuk <b>login pertama</b>, guru cukup pakai <b>tanggal lahir polos</b> (contoh 05/08/2010 → <b>05082010</b>).</li>
                    <li>Kalau <b>tanggal lahir</b> kosong, login pertama memakai <b>NIP/NUPTK</b> sebagai password sementara.</li>
                    <li>Login awal guru: pakai <b>Email</b> dan password sementara di atas.</li>
                    <li>NIP/NUPTK dipakai sebagai nomor induk guru, bukan username login awal di sistem ini.</li>
                    <li>Nama kelas harus mengarah ke kelas yang sudah dibuat di website ini.</li>
                    <li>Huruf besar dan kecil tidak ngaruh, jadi <b>x a mipa</b> dan <b>X A MIPA</b> akan dianggap sama.</li>
                    <li>Format upload yang didukung: <b>{SPREADSHEET_IMPORT_FORMAT_LABEL}</b>.</li>
                    <li>Setelah login, guru wajib mengganti password.</li>
                  </ul>
                </div>

                <div className="flex flex-wrap gap-4 text-sm">
                  <div className="px-4 py-2 rounded-lg bg-gray-50 border border-gray-200">
                    Data siap import: <b>{importRows.length}</b>
                  </div>
                  <div className="px-4 py-2 rounded-lg bg-gray-50 border border-gray-200">
                    Error validasi: <b>{importErrors.length}</b>
                  </div>
                </div>

                {importErrors.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                    <p className="font-semibold mb-2">Contoh error</p>
                    {importRows.length > 0 ? (
                      <p className="mb-2">Baris yang valid tetap bisa diimport. Baris error akan dilewati dan masuk ringkasan gagal.</p>
                    ) : null}
                    {importBlockingErrorMessage ? (
                      <p className="mb-2">{importBlockingErrorMessage}</p>
                    ) : null}
                    <ul className="list-disc list-inside space-y-1 max-h-28 overflow-auto">
                      {importErrors.slice(0, 5).map((err, idx) => (
                        <li key={`${err.row}-${idx}`}>
                          Baris {err.row}: {err.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {showImportProgress && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{importProgress.message || 'Menyiapkan import...'}</p>
                        <p className="text-xs text-blue-700">
                          {importProgressTotal > 0 ? `${importProgressCurrent}/${importProgressTotal} baris diproses` : 'Menyiapkan data'}
                        </p>
                      </div>
                      {importLoading ? (
                        <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />
                      ) : (
                        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-blue-700">
                          {importProgressPercent}%
                        </span>
                      )}
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white">
                      <div
                        className="h-full rounded-full bg-blue-600 transition-all duration-500"
                        style={{ width: `${importProgressPercent}%` }}
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {importProgressSteps.map(([key, label], index) => {
                        const done = index < importActiveStepIndex || importProgress.phase === 'done'
                        const active = index === importActiveStepIndex && importProgress.phase !== 'done'
                        return (
                          <div
                            key={key}
                            className={`rounded-lg border px-2 py-1.5 text-center text-xs font-semibold ${
                              done
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : active
                                  ? 'border-blue-200 bg-white text-blue-700'
                                  : 'border-blue-100 bg-blue-50/60 text-blue-500'
                            }`}
                          >
                            {label}
                          </div>
                        )
                      })}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-blue-800">
                      <span>Baru: <b>{importProgress.created || 0}</b></span>
                      <span>Update: <b>{importProgress.updated || 0}</b></span>
                      <span>Lewati: <b>{importProgress.skipped || 0}</b></span>
                      <span>Gagal: <b>{importProgress.failed || 0}</b></span>
                    </div>
                  </div>
                )}

                {importSummary && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">
                    <p className="font-semibold mb-2">Hasil Import</p>
                    <p>Baru: {importSummary.created} • Update: {importSummary.updated} • Lewati: {importSummary.skipped} • Gagal: {importSummary.failed}</p>
                    {importSummary.errors?.length ? (
                      <ul className="list-disc list-inside space-y-1 mt-2 max-h-28 overflow-auto">
                        {importSummary.errors.slice(0, 5).map((err, idx) => (
                          <li key={`${err.row}-${idx}`}>
                            Baris {err.row}: {err.reason}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-gray-200 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setImportModalOpen(false)
                    resetImportState()
                  }}
                  className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  onClick={handleRunImport}
                  disabled={!importCanRun}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
                >
                  {importButtonText}
                </button>
                {importButtonHint ? (
                  <p className="basis-full text-right text-xs text-gray-500">{importButtonHint}</p>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="page-title-card">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-md">
                <span className="text-2xl">👨‍🏫</span>
              </div>
              <div>
                <h1 className="page-title-heading">Manajemen Guru</h1>
                <p className="page-title-description">Kelola data guru, mata pelajaran, dan penugasan</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="px-4 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-all font-semibold text-sm"
                onClick={exportGuruToExcel}
              >
                ⬇️ Export
              </button>
              <button
                className="px-4 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-all font-semibold text-sm"
                onClick={() => setImportModalOpen(true)}
              >
                ⬆️ Import
              </button>
              <button
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold text-sm shadow-md transition-all"
                onClick={() => setShowAddForm(!showAddForm)}
              >
                {showAddForm ? '✕ Tutup Form' : '➕ Tambah Guru'}
              </button>
            </div>
          </div>
        </div>

        {/* Dashboard Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <GuruStatCard
            label="Total Guru"
            value={stats.totalGuru}
            icon="👨‍🏫"
            color="blue"
            description={`${stats.totalJabatan} posisi/jabatan`}
          />
          <GuruStatCard
            label="Guru Aktif"
            value={stats.aktifGuru}
            icon="✅"
            color="green"
            description="Sedang aktif mengajar"
          />
          <GuruStatCard
            label="Guru Nonaktif"
            value={stats.nonaktifGuru}
            icon="⏸️"
            color="orange"
            description="Tidak aktif sementara"
          />
          <GuruStatCard
            label="Guru Mutasi"
            value={stats.mutasiGuru}
            icon="📤"
            color="indigo"
            description="Pindah sekolah"
          />
        </div>

        {/* Form Tambah Guru */}
        {showAddForm && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100 px-6 py-4">
              <h3 className="text-lg font-bold text-blue-900 flex items-center gap-2">
                <span>➕</span>
                Tambah Guru Baru
              </h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="Email *" name="email" value={form.email} onChange={handleChange} placeholder="Email guru" type="email" required />
                <Input label="Nama Lengkap *" name="nama" value={form.nama} onChange={handleChange} placeholder="Nama lengkap" required />
                <Input label="Telepon" name="telp" value={form.telp} onChange={handleChange} placeholder="Nomor telepon" />
                <Input label="Password *" name="password" value={form.password} onChange={handleChange} placeholder="Min. 12 karakter, Aa, angka, simbol" type="password" required />
                <div className="md:col-span-2">
                  <Input label="Konfirmasi Password *" name="confirmPassword" value={form.confirmPassword} onChange={handleChange} placeholder="Ulangi password" type="password" required />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
                <button onClick={() => setShowAddForm(false)} className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-all">✕ Batal</button>
                <button onClick={handleAdd} disabled={!form.email || !form.nama || !form.password || form.password !== form.confirmPassword} className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold text-sm shadow-md disabled:opacity-50 transition-all">👨‍🏫 Daftarkan</button>
              </div>
            </div>
          </div>
        )}

        {/* Filter Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-100 px-6 py-4">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <span>🔍</span>
              Filter Pencarian
            </h3>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input label="Nama / Email" placeholder="Cari nama atau email guru" value={qNama} onChange={e => setQNama(e.target.value)} />
              <Select label="Mata Pelajaran" value={qMapel} onChange={e => setQMapel(e.target.value)} options={[{ value: '', label: 'Semua Mata Pelajaran' }, ...allMapelList.map(mapel => ({ value: mapel, label: mapel }))]} />
              <Select label="Jabatan" value={qJabatan} onChange={e => setQJabatan(e.target.value)} options={[{ value: '', label: 'Semua Jabatan' }, ...jabatanList.map(jab => ({ value: jab, label: jab }))]} />
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={resetFilter} className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-all">🔄 Reset</button>
              <button onClick={applyFilter} disabled={isSearching} className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold text-sm shadow-md transition-all disabled:opacity-70">{isSearching ? 'Mencari...' : '🔎 Cari'}</button>
            </div>
          </div>
        </div>

        {/* Tabel Guru */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-100 px-6 py-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <span>📊</span>
                Daftar Guru
              </h3>
              <span className="text-sm text-slate-500 bg-white border border-slate-200 px-3 py-1 rounded-full">
                {guru.length} dari {guruMeta.total || guruProcessed.length} guru
              </span>
            </div>
          </div>

          {loadingInit ? (
            <div className="p-6">
              <LoadingSkeleton />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-12">No</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Guru</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Mapel</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Kelas</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Jabatan</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {guru.map((g, index) => {
                    const foto = g.photo_path || g.photo_url || g.foto_url || g.foto || ''
                    const mapelPreview = listPreview(g.mapelList)
                    const kelasPreview = listPreview(g.kelasList)
                    const sourceMeta = getProfileSourceMeta(g.created_via)
                    const statusMeta = getGuruStatusMeta(g.status)
                    const canMutasiGuru = !isGuruExitStatus(g.status)
                    const guruOnline = isPresenceOnline(g.online) || Number(g.active_devices || 0) > 0

                    return (
                      <tr key={g.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-400 text-center">
                          {(guruMeta.from || 1) + index}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0">
                              <ProfileAvatar
                                src={foto}
                                name={g.nama}
                                size={40}
                                className="border-slate-200"
                                fallbackClassName="rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-sm font-medium text-blue-600"
                              />
                            </div>
                            <div className="ml-3">
                              <div className="text-sm font-semibold text-slate-900">{g.nama || '—'}</div>
                              <div className="text-xs text-slate-500">{g.email || '—'}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${sourceMeta.className}`}>
                                  {sourceMeta.label}
                                </span>
                                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${presenceBadgeClassName(g)}`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${guruOnline ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                  {formatPresenceText(g)}
                                </span>
                              </div>
                              {g.telp && <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><span>📞</span><span>{g.telp}</span></div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-sm text-slate-700" title={mapelPreview.title}>{mapelPreview.text}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-sm text-slate-700" title={kelasPreview.title}>{kelasPreview.text}</div>
                        </td>
                        <td className="px-4 py-4">
                          <JabatanBadge jabatanList={g.jabatanList} />
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${statusMeta.className}`}>
                            {statusMeta.icon} {statusMeta.label}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openDetailModal(g)} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-all">Detail</button>
                            <button onClick={() => openEditNameModal(g)} className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold transition-all">Edit Nama</button>
                            {g.status === 'active' ? (
                              <button onClick={() => openNonaktif(g)} className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-all">Nonaktif</button>
                            ) : (
                              <button onClick={() => aktif(g)} className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold transition-all">Aktifkan</button>
                            )}
                            {canMutasiGuru && (
                              <button onClick={() => openMutasiGuru(g)} disabled={mutatingGuru} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-all disabled:opacity-50">Mutasi</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {!guru.length && (
                    <tr>
                      <td colSpan="7" className="px-4 py-14 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <div className="text-5xl mb-3 opacity-30">👨‍🏫</div>
                          <p className="text-slate-600 font-semibold">Tidak ada data guru</p>
                          <p className="text-slate-400 text-sm mt-1">Coba ubah filter pencarian</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {guruMeta.total > 0 && (
                <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-500">
                    Menampilkan {guruMeta.from || 0}-{guruMeta.to || guru.length} dari {guruMeta.total} guru
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => loadAllData(Math.max(1, (guruMeta.page || 1) - 1))}
                      disabled={(guruMeta.page || 1) <= 1}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold disabled:opacity-50"
                    >
                      Sebelumnya
                    </button>
                    <span className="text-sm font-medium text-slate-600">
                      Halaman {guruMeta.page || 1} / {guruMeta.page_count || 1}
                    </span>
                    <button
                      onClick={() => loadAllData(Math.min(guruMeta.page_count || 1, (guruMeta.page || 1) + 1))}
                      disabled={(guruMeta.page || 1) >= (guruMeta.page_count || 1)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold disabled:opacity-50"
                    >
                      Berikutnya
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Nonaktifkan Guru */}
        {disableUID && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200">
              <div className="flex items-center gap-3 p-6 border-b border-slate-100">
                <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center"><span className="text-xl">⏸️</span></div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Nonaktifkan Guru</h3>
                  <p className="text-slate-500 text-sm">Guru akan diblokir di aplikasi</p>
                </div>
              </div>
              <div className="p-6">
                <label className="block text-sm font-semibold text-slate-700 mb-2">Alasan Penonaktifan *</label>
                <textarea
                  className="block w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-amber-400 min-h-[100px] text-sm"
                  placeholder="Contoh: Cuti panjang..."
                  value={alasanNonaktif}
                  onChange={e => setAlasanNonaktif(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-3 px-6 pb-6">
                <button onClick={batalNonaktif} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-all">✕ Batal</button>
                <button onClick={simpanNonaktif} disabled={!alasanNonaktif.trim()} className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm disabled:opacity-50 transition-all">⏸️ Nonaktifkan</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Edit Nama Guru */}
        {editNameOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <form
              onSubmit={submitTeacherNameEdit}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden"
            >
              <div className="flex items-center gap-3 p-6 border-b border-slate-100 bg-slate-50/80">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center"><span className="text-xl">👤</span></div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Edit Nama Guru</h3>
                  <p className="text-slate-500 text-sm">{teacherNameEdit.email || 'Email login'}</p>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <Input
                  label="Nama Guru *"
                  value={teacherNameEdit.nama}
                  onChange={(e) => setTeacherNameEdit(prev => ({ ...prev, nama: e.target.value }))}
                  placeholder="Nama lengkap guru"
                  maxLength={120}
                  required
                  autoFocus
                  disabled={savingTeacherName}
                />
                <Input
                  label="Email Login"
                  value={teacherNameEdit.email}
                  readOnly
                  className="bg-slate-50 text-slate-500"
                />
              </div>

              <div className="flex justify-end gap-3 px-6 pb-6">
                <button
                  type="button"
                  onClick={closeEditNameModal}
                  disabled={savingTeacherName}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-all disabled:opacity-50"
                >
                  ✕ Batal
                </button>
                <button
                  type="submit"
                  disabled={savingTeacherName || !teacherNameEdit.nama.trim()}
                  className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50 transition-all"
                >
                  {savingTeacherName ? 'Menyimpan...' : 'Simpan Nama'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Modal Mutasi Guru */}
        {mutasiGuruOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200">
              <div className="flex items-center gap-3 p-6 border-b border-indigo-100 bg-indigo-50/50 rounded-t-2xl">
                <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center"><span className="text-xl">📤</span></div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Mutasi Guru</h3>
                  <p className="text-slate-500 text-sm">Tandai guru pindah sekolah tanpa menghapus data</p>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                  <p className="text-indigo-800 text-sm font-semibold mb-2">Guru yang akan dimutasi:</p>
                  <p className="text-indigo-700 text-sm font-medium">{guruToMutasi?.nama} <span className="font-normal text-indigo-500">({guruToMutasi?.email})</span></p>
                  <p className="mt-3 text-indigo-600 text-xs">
                    Akun dan riwayat tetap tersimpan. Relasi aktif seperti jadwal, wali kelas, struktur sekolah, dan pembina akan dilepas.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Alasan/Catatan Mutasi *</label>
                  <textarea
                    className="block w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 min-h-[100px] text-sm"
                    placeholder="Contoh: Pindah tugas ke sekolah lain..."
                    value={alasanMutasiGuru}
                    onChange={event => setAlasanMutasiGuru(event.target.value)}
                    disabled={mutatingGuru}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 px-6 pb-6">
                <button onClick={closeMutasiGuru} disabled={mutatingGuru} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 disabled:opacity-50 transition-all">✕ Batal</button>
                <button onClick={simpanMutasiGuru} disabled={mutatingGuru || !alasanMutasiGuru.trim()} className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm disabled:opacity-50 transition-all">{mutatingGuru ? 'Memproses...' : 'Mutasikan'}</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Detail Guru */}
        {detailModalOpen && selectedGuru && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col border border-slate-200">
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-blue-50/30 flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <ProfileAvatar
                    src={selectedGuru.photo_path || selectedGuru.photo_url}
                    name={selectedGuru.nama}
                    size={52}
                    className="border-slate-200"
                    fallbackClassName="rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-base font-semibold text-blue-600"
                  />
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">{selectedGuru.nama}</h3>
                    <p className="text-slate-500 text-sm">{selectedGuru.email}</p>
                    {selectedGuru.telp && <p className="text-slate-400 text-xs flex items-center gap-1 mt-0.5"><span>📞</span><span>{selectedGuru.telp}</span></p>}
                    <div className="mt-2">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${selectedGuruStatusMeta.className}`}>
                        {selectedGuruStatusMeta.icon} {selectedGuruStatusMeta.label}
                      </span>
                      <span className={`ml-2 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${selectedGuruSourceMeta.className}`}>
                        {selectedGuruSourceMeta.label}
                      </span>
                    </div>
                  </div>
                </div>
                <button className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors" onClick={closeDetailModal}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
                  <h4 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2"><span>👤</span> Informasi Profil</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[['Email', selectedGuru.email], ['Telepon', selectedGuru.telp || '—'], ['NIS', selectedGuru.nis || '—'], ['Tanggal Lahir', formatDate(selectedGuru.tanggal_lahir)], ['Jenis Kelamin', selectedGuru.jk || '—'], ['Agama', selectedGuru.agama || '—'], ['Jabatan', selectedGuru.jabatan || '—'], ['Asal Data', selectedGuruSourceMeta.label]].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
                        <p className="text-sm text-slate-800 mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                  <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                    <h4 className="text-sm font-bold text-blue-800 mb-3">📚 Mapel ({selectedGuru.mapelList.length})</h4>
                    <div className="space-y-1.5">
                      {selectedGuru.mapelList.length > 0 ? selectedGuru.mapelList.map((m, i) => <div key={i} className="text-sm text-blue-700 bg-white rounded-lg px-3 py-1.5 border border-blue-100">{m}</div>) : <p className="text-blue-500 text-xs">Tidak ada</p>}
                    </div>
                  </div>
                  <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
                    <h4 className="text-sm font-bold text-indigo-800 mb-3">🏫 Kelas ({selectedGuru.kelasList.length})</h4>
                    <div className="space-y-1.5">
                      {selectedGuru.kelasList.length > 0 ? selectedGuru.kelasList.map((k, i) => <div key={i} className="text-sm text-indigo-700 bg-white rounded-lg px-3 py-1.5 border border-indigo-100">{k}</div>) : <p className="text-indigo-500 text-xs">Tidak ada</p>}
                    </div>
                  </div>
                  <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4">
                    <h4 className="text-sm font-bold text-purple-800 mb-3">💼 Jabatan ({selectedGuru.jabatanList.length})</h4>
                    <div className="space-y-1.5">
                      {selectedGuru.jabatanList.length > 0 ? selectedGuru.jabatanList.map((j, i) => <div key={i} className="text-sm text-purple-700 bg-white rounded-lg px-3 py-1.5 border border-purple-100">{j}</div>) : <p className="text-purple-500 text-xs">Tidak ada</p>}
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                <button onClick={closeDetailModal} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-100 transition-all">✕ Tutup</button>
                <button onClick={() => openEditNameModal(selectedGuru)} className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-800 text-white font-semibold text-sm transition-all">Edit Nama</button>
                {selectedGuru.status === 'active' ? (
                  <button onClick={() => openNonaktif(selectedGuru)} className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm transition-all">Nonaktif</button>
                ) : (
                  <button onClick={() => aktif(selectedGuru)} className="px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold text-sm transition-all">Aktifkan</button>
                )}
                {selectedGuruCanMutasi && (
                  <button onClick={() => openMutasiGuru(selectedGuru)} className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition-all">Mutasi</button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
