import React, { useEffect, useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/time'
import { useUIStore } from '../../store/useUIStore'
import ProfileAvatar from '../../components/ProfileAvatar'
import PasswordInput from '../../components/PasswordInput'
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
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

const normalizeStatusValue = (value) => {
  if (!value) return ''
  const s = String(value).trim().toLowerCase()
  if (['aktif', 'active'].includes(s)) return 'active'
  if (['nonaktif', 'inactive'].includes(s)) return 'nonaktif'
  if (['mutasi', 'pindah'].includes(s)) return 'mutasi'
  if (['alumni', 'lulus', 'graduate'].includes(s)) return 'alumni'
  return ''
}

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
  const { pushToast } = useUIStore()
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

  // Form tambah guru
  const [form, setForm] = useState({
    email: '',
    nama: '',
    telp: '',
    password: '',
    confirmPassword: ''
  })
  const [showAddForm, setShowAddForm] = useState(false)

  // Hapus guru
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [guruToDelete, setGuruToDelete] = useState(null)
  const [deletingGuru, setDeletingGuru] = useState(false)

  // Import / Export
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importSource, setImportSource] = useState('file')
  const [importFile, setImportFile] = useState(null)
  const [sheetUrl, setSheetUrl] = useState('')
  const [importRows, setImportRows] = useState([])
  const [importErrors, setImportErrors] = useState([])
  const [importLoading, setImportLoading] = useState(false)
  const [importSummary, setImportSummary] = useState(null)

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

  const loadAllData = async () => {
    try {
      setLoadingInit(true)
      await Promise.all([
        loadGuruRaw(),
        loadKelasList(),
        loadJadwalAll(),
        loadStrukturKelasAll(),
        loadStrukturSekolah()
      ])
    } catch (error) {
      console.error('Error loading data:', error)
      pushToast('error', 'Gagal memuat data')
    } finally {
      setLoadingInit(false)
    }
  }

  const loadGuruRaw = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'guru')
      .order('nama')

    if (error) throw error
    setGuruRaw(data || [])
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
      const mapelSet = new Set()
      const kelasSet = new Set()
      const jabatanSet = new Set()

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
  }, [strukturSekolah, strukturKelasAll, guruRaw])
  
  // Mapel list untuk filter
  const allMapelList = useMemo(() => {
    const mapelSet = new Set()
    guruProcessed.forEach(g => {
      g.mapelList.forEach(mapel => mapelSet.add(mapel))
    })
    return Array.from(mapelSet).sort()
  }, [guruProcessed])

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
          reason: `Kelas tidak ditemukan: ${normalized.kelas_raw}`
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
  }

  const handleImportFileChange = async (file) => {
    if (!file) return
    setImportFile(file)
    setImportLoading(true)
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
    const csvUrl = buildGoogleSheetCsvUrl(sheetUrl)
    if (!csvUrl) {
      pushToast('error', 'Link Google Sheets tidak valid')
      return
    }

    setImportLoading(true)
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
      .select('id, role, email, nis')
      .eq('nis', nis)
      .maybeSingle()

    if (exError) throw exError

    if (!existing) {
      const { data: byEmail } = await supabase
        .from('profiles')
        .select('id, role, email, nis')
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
      if (existing.role && existing.role !== 'guru') {
        throw new Error('NIS/NIP sudah digunakan untuk role lain')
      }

      const existingEmail = String(existing.email || '').trim().toLowerCase()
      if (!existingEmail || existingEmail !== emailLower) {
        payload.email = emailLower
      }

      const updateKeys = Object.keys(payload).filter((k) => k !== 'updated_at')
      if (!updateKeys.length) return 'skipped'

      const { error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', existing.id)

      if (error) throw error
      return 'updated'
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: emailForAuth,
      password,
      options: {
        data: {
          nama,
          role: 'guru'
        }
      }
    })

    if (authError) throw authError
    const userId = authData?.user?.id
    if (!userId) throw new Error('User gagal dibuat')

    const createPayload = {
      ...payload,
      role: 'guru',
      email: emailForAuth,
      status: payload.status || 'active',
      must_change_password: true
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update(createPayload)
      .eq('id', userId)

    if (updateError) throw updateError

    return 'created'
  }

  const handleRunImport = async () => {
    if (!importRows.length) {
      pushToast('error', 'Tidak ada data untuk diimport')
      return
    }

    if (!kelasList.length) {
      pushToast('error', 'Belum ada data kelas. Buat kelas terlebih dahulu sebelum import guru.')
      return
    }

    setImportLoading(true)
    const summary = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: []
    }

    for (const row of importRows) {
      try {
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
      }
    }

    setImportSummary(summary)
    setImportLoading(false)
    await loadGuruRaw()
  }

  const exportGuruToExcel = () => {
    const rows = guru.map((item, idx) => ({
      No: idx + 1,
      NIS: item.nis || '',
      Nama: item.nama || '',
      Email: item.email || '',
      Telp: item.telp || '',
      Jabatan: item.jabatan || item.jabatanUtama || '',
      Mapel: (item.mapelList || []).join(', '),
      Kelas: (item.kelasList || []).join(', '),
      Status: item.status || 'active'
    }))

    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Guru')
    const stamp = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(workbook, `guru_${stamp}.xlsx`)
  }

  // Statistik untuk dashboard
  const stats = useMemo(() => {
    const totalGuru = guruProcessed.length
    const aktifGuru = guruProcessed.filter(g => g.status === 'active').length
    const nonaktifGuru = guruProcessed.filter(g => g.status === 'nonaktif').length
    const totalJabatan = jabatanList.length

    return {
      totalGuru,
      aktifGuru,
      nonaktifGuru,
      totalJabatan
    }
  }, [guruProcessed, jabatanList])

  // Update state guru ketika data diproses
  useEffect(() => {
    setGuru(guruProcessed)
  }, [guruProcessed])

  /* ===== Filter ===== */
  function applyFilter() {
    setIsSearching(true)
    setTimeout(() => {
      const nama = qNama.trim().toLowerCase()
      const mapel = qMapel.trim()
      const jab = qJabatan.trim()

      const res = guruProcessed.filter(g => {
        const namaOk = nama
          ? (String(g.nama || '').toLowerCase().includes(nama) || String(g.email || '').toLowerCase().includes(nama))
          : true
        const mapelOk = mapel
          ? g.mapelList.some(m => m === mapel)
          : true
        const jabatanOk = jab
          ? g.jabatanList.some(j => j === jab)
          : true
        return namaOk && mapelOk && jabatanOk
      })

      setGuru(res)
      setIsSearching(false)
    }, 200)
  }

  function resetFilter() {
    setQNama('')
    setQMapel('')
    setQJabatan('')
    setGuru(guruProcessed)
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

    if (form.password.length < 6) {
      return pushToast('error', 'Password minimal 6 karakter')
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            nama: form.nama,
            role: 'guru'
          }
        }
      })

      if (authError) throw authError

      const { error } = await supabase.from('profiles').insert({
        id: authData.user.id,
        email: form.email,
        nama: form.nama,
        telp: form.telp,
        role: 'guru',
        status: 'active',
        created_at: new Date().toISOString()
      })

      if (error) throw error

      pushToast('success', 'Guru berhasil didaftarkan')
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
          await supabase
            .from('profiles')
            .update({
              status: 'nonaktif',
              alasan_nonaktif: alasanNonaktif || '-',
              disabled_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', disableUID)

          pushToast('success', 'Guru berhasil dinonaktifkan')
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
          await supabase
            .from('profiles')
            .update({
              status: 'active',
              alasan_nonaktif: null,
              disabled_at: null,
              updated_at: new Date().toISOString()
            })
            .eq('id', u.id)

          pushToast('success', 'Guru berhasil diaktifkan')
          loadGuruRaw()
        } catch (error) {
          console.error('Error activating guru:', error)
          pushToast('error', 'Gagal mengaktifkan guru')
        }
      }
    )
  }

  /* ===== Hapus Akun Guru ===== */
  function openDeleteConfirm(guru) {
    setGuruToDelete(guru)
    setDeleteConfirmOpen(true)
  }

  function closeDeleteConfirm() {
    setDeleteConfirmOpen(false)
    setGuruToDelete(null)
  }

  const hapusAkunGuru = async () => {
    if (!guruToDelete) return

    try {
      setDeletingGuru(true)
      const { error } = await supabase.admin.deleteUser(guruToDelete.id)
      if (error) throw error

      pushToast('success', 'Akun guru berhasil dihapus')
      closeDeleteConfirm()
      if (detailModalOpen) closeDetailModal()
      loadAllData()
    } catch (error) {
      console.error('Error deleting guru:', error)
      pushToast('error', 'Gagal menghapus akun guru: ' + (error.message || 'Unknown error'))
    } finally {
      setDeletingGuru(false)
    }
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
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden">
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

              <div className="p-6 space-y-5">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                      importSource === 'file'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-200'
                    }`}
                    onClick={() => setImportSource('file')}
                  >
                    📁 Upload File
                  </button>
                  <button
                    type="button"
                    className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                      importSource === 'sheet'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-200'
                    }`}
                    onClick={() => setImportSource('sheet')}
                  >
                    📊 Google Sheets
                  </button>
                </div>

                {importSource === 'file' && (
                  <div className="space-y-3">
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={(e) => handleImportFileChange(e.target.files?.[0])}
                      className="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                      disabled={importLoading}
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
                      disabled={importLoading}
                    />
                    <button
                      type="button"
                      onClick={handleLoadSheet}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                      disabled={importLoading || !sheetUrl.trim()}
                    >
                      Ambil Data
                    </button>
                  </div>
                )}

                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
                  <p className="font-semibold mb-1">Catatan penting</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Kolom wajib: <b>Nama</b>, <b>NIS/NIP</b>, <b>Email</b>, dan <b>Kelas</b>.</li>
                    <li>Password awal otomatis dari <b>tanggal lahir</b> (contoh 05/08/2010 → 05082010).</li>
                    <li>Login awal guru: pakai <b>Email</b> dan password tanggal lahir.</li>
                    <li>Nama kelas dari Excel harus sama dengan kelas yang sudah dibuat (otomatis dicocokkan uppercase).</li>
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
                    <ul className="list-disc list-inside space-y-1 max-h-28 overflow-auto">
                      {importErrors.slice(0, 5).map((err, idx) => (
                        <li key={`${err.row}-${idx}`}>
                          Baris {err.row}: {err.reason}
                        </li>
                      ))}
                    </ul>
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
                  disabled={importLoading || !importRows.length}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
                >
                  {importLoading ? 'Memproses...' : 'Mulai Import'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <span className="text-2xl text-blue-600">👨‍🏫</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-1">Manajemen Guru</h1>
                <p className="text-gray-600">Kelola data guru, mata pelajaran, dan penugasan</p>
              </div>
            </div>
            <div className="mt-4 lg:mt-0 flex flex-col sm:flex-row gap-2">
              <button
                className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-lg border border-emerald-200 hover:bg-emerald-100 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-all duration-200 font-medium"
                onClick={exportGuruToExcel}
              >
                ⬇️ Export
              </button>
              <button
                className="bg-amber-50 text-amber-700 px-4 py-2 rounded-lg border border-amber-200 hover:bg-amber-100 focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 transition-all duration-200 font-medium"
                onClick={() => setImportModalOpen(true)}
              >
                ⬆️ Import
              </button>
              <button
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 font-medium"
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
            description="Semua guru terdaftar"
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
            label="Jabatan" 
            value={stats.totalJabatan} 
            icon="💼" 
            color="teal"
            description="Posisi/jabatan"
          />
        </div>

        {/* Form Tambah Guru */}
        {showAddForm && (
          <Card className="mb-6">
            <div className="bg-blue-50 border-b border-blue-200 p-4">
              <h3 className="text-lg font-semibold text-blue-900 flex items-center gap-2">
                <span>➕</span>
                Tambah Guru Baru
              </h3>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Email *"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="Email guru"
                  type="email"
                  required
                />
                <Input
                  label="Nama Lengkap *"
                  name="nama"
                  value={form.nama}
                  onChange={handleChange}
                  placeholder="Nama lengkap"
                  required
                />
                <Input
                  label="Telepon"
                  name="telp"
                  value={form.telp}
                  onChange={handleChange}
                  placeholder="Nomor telepon"
                />
                <Input
                  label="Password *"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Password minimal 6 karakter"
                  type="password"
                  required
                />
                <div className="md:col-span-2">
                  <Input
                    label="Konfirmasi Password *"
                    name="confirmPassword"
                    value={form.confirmPassword}
                    onChange={handleChange}
                    placeholder="Ulangi password"
                    type="password"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-4 pt-4 border-t border-gray-200">
                <Button
                  variant="secondary"
                  onClick={() => setShowAddForm(false)}
                >
                  ✕ Batal
                </Button>
                <Button
                  onClick={handleAdd}
                  disabled={
                    !form.email ||
                    !form.nama ||
                    !form.password ||
                    form.password !== form.confirmPassword
                  }
                >
                  👨‍🏫 Daftarkan
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Filter Section */}
        <Card>
          <div className="bg-gray-50 border-b border-gray-200 p-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <span>🔍</span>
              Filter Pencarian
            </h3>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="Nama / Email"
                placeholder="Cari nama atau email guru"
                value={qNama}
                onChange={e => setQNama(e.target.value)}
              />
              <Select
                label="Mata Pelajaran"
                value={qMapel}
                onChange={e => setQMapel(e.target.value)}
                options={[
                  { value: '', label: 'Semua Mata Pelajaran' },
                  ...allMapelList.map(mapel => ({ value: mapel, label: mapel }))
                ]}
              />
              <Select
                label="Jabatan"
                value={qJabatan}
                onChange={e => setQJabatan(e.target.value)}
                options={[
                  { value: '', label: 'Semua Jabatan' },
                  ...jabatanList.map(jab => ({ value: jab, label: jab }))
                ]}
              />
            </div>
            <div className="flex justify-end space-x-3 mt-4">
              <Button
                onClick={applyFilter}
                loading={isSearching}
              >
                Cari
              </Button>
              <Button
                variant="secondary"
                onClick={resetFilter}
              >
                🔄 Reset
              </Button>
            </div>
          </div>
        </Card>

        {/* Tabel Guru */}
        <Card>
          <div className="bg-gray-50 border-b border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <span>📊</span>
                Daftar Guru
              </h3>
              <span className="text-sm text-gray-600">
                {guru.length} dari {guruProcessed.length} guru
              </span>
            </div>
          </div>

          {loadingInit ? (
            <div className="p-4">
              <LoadingSkeleton />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b w-12">
                      No
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
                      Guru
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
                      Mapel
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
                      Kelas
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
                      Jabatan
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {guru.map((g, index) => {
                    const foto = g.photo_path || g.photo_url || g.foto_url || g.foto || ''
                    const mapelPreview = listPreview(g.mapelList)
                    const kelasPreview = listPreview(g.kelasList)
                    
                    return (
                      <tr key={g.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-center">
                          {index + 1}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10">
                              <ProfileAvatar
                                src={foto}
                                name={g.nama}
                                size={40}
                                className="border-gray-200"
                                fallbackClassName="rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-sm font-medium text-blue-600"
                              />
                            </div>
                            <div className="ml-3">
                              <div className="text-sm font-medium text-gray-900">
                                {g.nama || '—'}
                              </div>
                              <div className="text-sm text-gray-500">
                                {g.email || '—'}
                              </div>
                              {g.telp && <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                                <span>📞</span>
                                <span>{g.telp}</span>
                              </div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-gray-900" title={mapelPreview.title}>
                            {mapelPreview.text}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-gray-900" title={kelasPreview.title}>
                            {kelasPreview.text}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <JabatanBadge jabatanList={g.jabatanList} />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {g.status === 'nonaktif' ? (
                            <Badge variant="danger" className="text-xs">
                              ⏸️ Nonaktif
                            </Badge>
                          ) : (
                            <Badge variant="success" className="text-xs">
                              ✅ Aktif
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium space-x-1">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => openDetailModal(g)}
                          >
                            Detail
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => openDeleteConfirm(g)}
                            disabled={deletingGuru}
                          >
                            Hapus
                          </Button>
                          {g.status === 'nonaktif' ? (
                            <Button
                              variant="success"
                              size="sm"
                              onClick={() => aktif(g)}
                            >
                              Aktifkan
                            </Button>
                          ) : (
                            <Button
                              variant="warning"
                              size="sm"
                              onClick={() => openNonaktif(g)}
                            >
                              Nonaktif
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {!guru.length && (
                    <tr>
                      <td colSpan="7" className="px-4 py-8 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <div className="text-gray-300 text-4xl mb-2">👨‍🏫</div>
                          <p className="text-gray-500 font-medium mb-1">Tidak ada data guru</p>
                          <p className="text-gray-400 text-sm">Coba ubah filter pencarian</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Modal Nonaktifkan Guru */}
        {disableUID && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-orange-100 text-orange-600 rounded-lg">
                  <span className="text-xl">⏸️</span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Nonaktifkan Guru</h3>
                  <p className="text-gray-600 text-sm">Guru akan diblokir di aplikasi</p>
                </div>
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Alasan Penonaktifan *
                </label>
                <textarea
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 min-h-[100px]"
                  placeholder="Contoh: Cuti panjang..."
                  value={alasanNonaktif}
                  onChange={e => setAlasanNonaktif(e.target.value)}
                  required
                />
              </div>
              
              <div className="flex justify-end space-x-3">
                <Button
                  variant="secondary"
                  onClick={batalNonaktif}
                >
                  ✕ Batal
                </Button>
                <Button
                  onClick={simpanNonaktif}
                  disabled={!alasanNonaktif.trim()}
                >
                  ⏸️ Nonaktifkan
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Konfirmasi Hapus Akun */}
        {deleteConfirmOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-red-100 text-red-600 rounded-lg">
                  <span className="text-xl">🗑️</span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Hapus Akun Guru</h3>
                  <p className="text-gray-600 text-sm">Tindakan ini tidak dapat dibatalkan</p>
                </div>
              </div>
              
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-red-800 text-sm font-medium mb-2">
                  Apakah Anda yakin ingin menghapus akun guru ini?
                </p>
                <p className="text-red-700 text-sm">
                  <strong>{guruToDelete?.nama}</strong> ({guruToDelete?.email})
                </p>
                <p className="text-red-600 text-xs mt-2">
                  • Akun akan dihapus dari database dan authentication
                  <br />
                  • Semua data terkait (jadwal, struktur) akan dihapus
                  <br />
                  • Tindakan ini PERMANEN dan tidak dapat dikembalikan
                </p>
              </div>

              <div className="flex justify-end space-x-3">
                <Button
                  variant="secondary"
                  onClick={closeDeleteConfirm}
                >
                  ✕ Batal
                </Button>
                <Button
                  variant="danger"
                  onClick={hapusAkunGuru}
                  loading={deletingGuru}
                >
                  🗑️ Ya, Hapus
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Detail Guru */}
        {detailModalOpen && selectedGuru && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
              {/* Header */}
              <div className="px-6 py-4 border-b bg-gray-50 flex items-start justify-between">
                <div className="flex items-center space-x-4">
                  <ProfileAvatar
                    src={selectedGuru.photo_path || selectedGuru.photo_url}
                    name={selectedGuru.nama}
                    size={48}
                    className="border-gray-200"
                    fallbackClassName="rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-base font-semibold text-blue-600"
                  />
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{selectedGuru.nama}</h3>
                    <p className="text-gray-600 text-sm">{selectedGuru.email}</p>
                    {selectedGuru.telp && <p className="text-gray-500 text-xs flex items-center gap-1 mt-1">
                      <span>📞</span>
                      <span>{selectedGuru.telp}</span>
                    </p>}
                    <div className="flex items-center space-x-2 mt-1">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        selectedGuru.status === 'active' 
                          ? 'bg-green-100 text-green-800 border border-green-200' 
                          : 'bg-red-100 text-red-800 border border-red-200'
                      }`}>
                        {selectedGuru.status === 'active' ? '✅ Aktif' : '⏸️ Nonaktif'}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                  onClick={closeDetailModal}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-6 overflow-y-auto flex-1">
                {/* Informasi Profil */}
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <h4 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <span>👤</span>
                    Informasi Profil
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-700">Email</p>
                      <p className="text-sm text-gray-900">{selectedGuru.email}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">Telepon</p>
                      <p className="text-sm text-gray-900">{selectedGuru.telp || '—'}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">NIS</p>
                      <p className="text-sm text-gray-900">{selectedGuru.nis || '—'}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">Tanggal Lahir</p>
                      <p className="text-sm text-gray-900">{formatDate(selectedGuru.tanggal_lahir)}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">Jenis Kelamin</p>
                      <p className="text-sm text-gray-900">{selectedGuru.jk || '—'}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">Agama</p>
                      <p className="text-sm text-gray-900">{selectedGuru.agama || '—'}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">Jabatan Profil</p>
                      <p className="text-sm text-gray-900">{selectedGuru.jabatan || '—'}</p>
                    </div>
                  </div>
                </div>

                {/* Mata Pelajaran Diampu */}
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <h4 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <span>📚</span>
                    Mata Pelajaran Diampu ({selectedGuru.mapelList.length})
                  </h4>
                  <div className="space-y-2">
                    {selectedGuru.mapelList.length > 0 ? (
                      selectedGuru.mapelList.map((mapel, index) => (
                        <div key={index} className="flex items-center p-2 bg-gray-50 rounded-lg">
                          <span className="text-sm text-gray-900">{mapel}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-gray-500 text-sm text-center py-2">Tidak ada mata pelajaran</p>
                    )}
                  </div>
                </div>

                {/* Kelas Diampu */}
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <h4 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <span>🏫</span>
                    Kelas Diampu ({selectedGuru.kelasList.length})
                  </h4>
                  <div className="space-y-2">
                    {selectedGuru.kelasList.length > 0 ? (
                      selectedGuru.kelasList.map((kelas, index) => (
                        <div key={index} className="flex items-center p-2 bg-gray-50 rounded-lg">
                          <span className="text-sm text-gray-900">{kelas}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-gray-500 text-sm text-center py-2">Tidak ada kelas</p>
                    )}
                  </div>
                </div>

                {/* Semua Jabatan */}
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <h4 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <span>💼</span>
                    Semua Jabatan ({selectedGuru.jabatanList.length})
                  </h4>
                  <div className="space-y-2">
                    {selectedGuru.jabatanList.length > 0 ? (
                      selectedGuru.jabatanList.map((jabatan, index) => (
                        <div key={index} className="flex items-center p-2 bg-gray-50 rounded-lg">
                          <span className="text-sm text-gray-900">{jabatan}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-gray-500 text-sm text-center py-2">Tidak ada jabatan</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t bg-gray-50 flex justify-end space-x-3">
                <Button
                  variant="secondary"
                  onClick={closeDetailModal}
                >
                  ✕ Tutup
                </Button>
                <Button
                  onClick={() => openDeleteConfirm(selectedGuru)}
                  variant="danger"
                >
                  🗑️ Hapus Akun
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
