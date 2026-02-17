// src/pages/admin/ASiswa.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/time'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
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
import { useLocation } from 'react-router-dom'

/* ===========================
   Password Modal Component
=========================== */
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

/* ===========================
   Password Verification Utility
   Catatan: signInWithPassword akan refresh session user yg sama.
=========================== */
const verifyPassword = async (password) => {
  const { data: { user }, error: userErr } = await supabase.auth.getUser()
  if (userErr) throw userErr
  if (!user?.email) throw new Error('User tidak ditemukan / email tidak tersedia')

  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password
  })

  if (error) throw new Error('Password salah')
  return true
}

/* ===========================
   Utils
=========================== */
function initials(name = '?') {
  const parts = (name || '').trim().split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('')
}

const JK_LABEL = (jk) => {
  if (!jk) return '—'
  const s = String(jk).toLowerCase()
  if (['l', 'laki', 'laki-laki', 'male'].includes(s)) return 'Laki-laki'
  if (['p', 'perempuan', 'female'].includes(s)) return 'Perempuan'
  return jk
}

const STATUS_META = (status) => {
  const st = String(status || '').toLowerCase()
  if (st === 'active') return { key: 'active', label: 'Aktif', icon: '✅', variant: 'success' }
  if (st === 'nonaktif' || st === 'inactive') return { key: 'nonaktif', label: 'Nonaktif', icon: '⏸️', variant: 'danger' }
  if (st === 'mutasi') return { key: 'mutasi', label: 'Mutasi', icon: '📤', variant: 'info' }
  if (st === 'alumni') return { key: 'alumni', label: 'Alumni', icon: '🎓', variant: 'primary' }
  if (!st) return { key: '', label: '—', icon: '', variant: 'default' }
  return { key: st, label: status, icon: '•', variant: 'default' }
}

const GRADE_REGEX = /^\s*(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I|\d+)/i
function getGradeRaw(kelasId = '') {
  const m = String(kelasId || '').toUpperCase().match(GRADE_REGEX)
  return m ? m[1] : ''
}

const NUM2ROMAN = {
  '1': 'I', '2': 'II', '3': 'III', '4': 'IV',
  '5': 'V', '6': 'VI', '7': 'VII', '8': 'VIII',
  '9': 'IX', '10': 'X', '11': 'XI', '12': 'XII'
}
function canonGrade(x) {
  if (!x) return ''
  const s = String(x).toUpperCase().trim()
  if (/^\d+$/.test(s)) return NUM2ROMAN[s] || s
  return s
}

function getGradeLabel(kelasId = '') {
  return canonGrade(getGradeRaw(kelasId))
}

function getKelasDisplayName(kelasObj) {
  if (!kelasObj) return ''
  return kelasObj.nama || kelasObj.id || ''
}

/* ===== Phone helpers (Indonesia) =====
   Normalisasi disimpan ke bentuk "0xxxxxxxxxx" (tanpa +62).
*/
function normalizePhoneID(input) {
  if (!input) return ''
  const digits = String(input).replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('62')) return '0' + digits.slice(2)
  if (digits.startsWith('8')) return '0' + digits
  if (digits.startsWith('0')) return digits
  return digits
}

const validatePhoneNumber = (raw, fieldName) => {
  if (!raw) return ''
  const normalized = normalizePhoneID(raw)
  if (!normalized) return ''
  if (normalized.length > 14) return `Nomor ${fieldName} maksimal 14 digit`

  // 0 + operator (2-9) + 7..11 digit => total 9..13 digit setelah 0
  const re = /^0[2-9]\d{7,11}$/
  if (!re.test(normalized)) {
    return `Format nomor ${fieldName} tidak valid. Contoh: 081234567890`
  }
  return ''
}

const formatPhoneDisplay = (phone) => {
  if (!phone) return '—'
  const clean = normalizePhoneID(phone)
  if (!clean) return '—'

  // contoh sederhana: 0812-3456-7890 (tidak memaksakan operator spesifik)
  if (clean.startsWith('0') && clean.length >= 10) {
    const p1 = clean.slice(0, 4)
    const p2 = clean.slice(4, 8)
    const p3 = clean.slice(8)
    return `${p1}-${p2}-${p3}`
  }
  return phone
}

const SISWA_ALIAS_MAP = buildAliasMap({
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
  status: ['status']
})

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

const normalizeStatusValue = (value) => {
  if (!value) return ''
  const s = String(value).trim().toLowerCase()
  if (['aktif', 'active'].includes(s)) return 'active'
  if (['nonaktif', 'inactive'].includes(s)) return 'nonaktif'
  if (['mutasi', 'pindah'].includes(s)) return 'mutasi'
  if (['alumni', 'lulus', 'graduate'].includes(s)) return 'alumni'
  return ''
}

const calculateAgeFromIsoDate = (isoDate) => {
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

const createClientUuid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

const IMPORT_SOURCE_LABEL = {
  file: 'Upload File',
  sheet: 'Google Sheets'
}

/* ===========================
   UI Components
=========================== */
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

function StatCard({ label, value, icon, color = 'blue', description }) {
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
    orange: 'bg-orange-500',
    indigo: 'bg-indigo-500'
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

/* =======================================================================
   MAIN COMPONENT - SISWA
======================================================================= */
export default function ASiswa() {
  const { pushToast } = useUIStore()
  const { user, profile } = useAuthStore()
  const [loadingInit, setLoadingInit] = useState(true)
  const location = useLocation()

  const role = profile?.role
  const isAdmin = role === 'admin'
  const isGuru = role === 'guru'
  const isGuruRoute = location.pathname.startsWith('/guru')
  const canManage = isAdmin && !isGuruRoute
  const canManageRfid = isAdmin || isGuru

  /* ===== Password Modal State ===== */
  const [passwordModal, setPasswordModal] = useState({
    isOpen: false,
    title: '',
    action: null,
    loading: false
  })

  // Data states
  const [siswaRaw, setSiswaRaw] = useState([])
  const [siswa, setSiswa] = useState([])
  const [kelasList, setKelasList] = useState([])
  const [strukturKelas, setStrukturKelas] = useState({})
  const [waliKelasIds, setWaliKelasIds] = useState([])
  const [waliChecked, setWaliChecked] = useState(false)
  const isWaliBlocked = isGuru && waliChecked && !waliKelasIds.length

  // Search fields
  const [qNama, setQNama] = useState('')
  const [qNIS, setQNIS] = useState('')
  const [qKelas, setQKelas] = useState('')
  const [qHasRfid, setQHasRfid] = useState('')
  const [qStatus, setQStatus] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const filterTimerRef = useRef(null)

  // Detail modal state
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailUser, setDetailUser] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Organisasi & OSIS
  const [orgAll, setOrgAll] = useState([])
  const [orgMember, setOrgMember] = useState([])
  const [osisRow, setOsisRow] = useState(null)

  // Pindah kelas (di detail)
  const [moveKelas, setMoveKelas] = useState('')
  const [moveGrade, setMoveGrade] = useState('')

  // Form tambah siswa
  const [form, setForm] = useState({
    email: '',
    nama: '',
    kelas: '',
    nis: '',
    jk: '',
    password: '',
    confirmPassword: ''
  })
  const [formErrors, setFormErrors] = useState({})
  const [showAddForm, setShowAddForm] = useState(false)
  const [addingSiswa, setAddingSiswa] = useState(false)

  // Hapus siswa
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [siswaToDelete, setSiswaToDelete] = useState(null)
  const [deletingSiswa, setDeletingSiswa] = useState(false)

  // RFID
  const [rfidInput, setRfidInput] = useState('')
  const [rfidEnrolling, setRfidEnrolling] = useState(false)
  const [rfidLastScan, setRfidLastScan] = useState(null)
  const [rfidChannel, setRfidChannel] = useState(null)

  // Nonaktifkan siswa
  const [nonaktifModalOpen, setNonaktifModalOpen] = useState(false)
  const [alasanNonaktif, setAlasanNonaktif] = useState('')
  const [siswaToNonaktif, setSiswaToNonaktif] = useState(null)

  // Aktifkan siswa
  const [aktifkanModalOpen, setAktifkanModalOpen] = useState(false)
  const [siswaToAktifkan, setSiswaToAktifkan] = useState(null)

  // Kenaikan kelas massal
  const [promotionModalOpen, setPromotionModalOpen] = useState(false)
  const [promotionMode, setPromotionMode] = useState('kelas') // 'kelas' | 'selected'
  const [promotionFromKelas, setPromotionFromKelas] = useState('')
  const [promotionToKelas, setPromotionToKelas] = useState('')
  const [promotionLoading, setPromotionLoading] = useState(false)
  const [promotionFilterGrade, setPromotionFilterGrade] = useState('')
  const [promotionFilterKelas, setPromotionFilterKelas] = useState('')
  const [promotionSelectedIds, setPromotionSelectedIds] = useState([])

  const PROMO_ALUMNI = '__ALUMNI__'
  const PROMO_MUTASI = '__MUTASI__'

  const [promotionAlumniYear, setPromotionAlumniYear] = useState(String(new Date().getFullYear()))
  const [promotionExitReason, setPromotionExitReason] = useState('')

  // Edit HP Siswa & Wali
  const [editingPhone, setEditingPhone] = useState(false)
  const [editPhoneForm, setEditPhoneForm] = useState({
    no_hp_siswa: '',
    no_hp_wali: ''
  })
  const [phoneErrors, setPhoneErrors] = useState({})

  // Import / Export
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importSource, setImportSource] = useState('file')
  const [importFile, setImportFile] = useState(null)
  const [sheetUrl, setSheetUrl] = useState('')
  const [importRows, setImportRows] = useState([])
  const [importErrors, setImportErrors] = useState([])
  const [importLoading, setImportLoading] = useState(false)
  const [importSummary, setImportSummary] = useState(null)
  const [importHistories, setImportHistories] = useState([])
  const [importHistoryItems, setImportHistoryItems] = useState([])
  const [selectedImportHistory, setSelectedImportHistory] = useState(null)
  const [importHistoryLoading, setImportHistoryLoading] = useState(false)
  const [importHistoryDetailLoading, setImportHistoryDetailLoading] = useState(false)
  const [importHistoryActionLoading, setImportHistoryActionLoading] = useState(false)

  /* ===== Cleanup channel ===== */
  useEffect(() => {
    return () => {
      if (rfidChannel) {
        try { supabase.removeChannel(rfidChannel) } catch {}
      }
    }
  }, [rfidChannel])

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
      if (passwordModal.action) {
        await passwordModal.action()
      }
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

  /* ===== Load initial data ===== */
  useEffect(() => {
    if (!role || !user?.id) return
    loadAllData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, user?.id])

  const loadWaliKelas = async () => {
    if (!isGuru || !user?.id) {
      setWaliKelasIds([])
      setWaliChecked(true)
      return []
    }

    const { data, error } = await supabase
      .from('kelas_struktur')
      .select('kelas_id')
      .eq('wali_guru_id', user.id)

    if (error) throw error

    const ids = (data || []).map(item => item.kelas_id).filter(Boolean)
    setWaliKelasIds(ids)
    setWaliChecked(true)
    return ids
  }

  const loadAllData = async () => {
    try {
      setLoadingInit(true)
      let waliIds = []

      if (!isAdmin && isGuru) {
        waliIds = await loadWaliKelas()
        if (!waliIds.length) {
          setSiswaRaw([])
          setSiswa([])
          setKelasList([])
          setStrukturKelas({})
          return
        }
      } else {
        setWaliChecked(true)
      }

      await Promise.all([
        loadSiswaRaw(waliIds),
        loadKelasList(waliIds),
        loadStrukturKelas(waliIds)
      ])
    } catch (error) {
      console.error('Error loading data:', error)
      pushToast('error', 'Gagal memuat data')
      if (isGuru) setWaliChecked(true)
    } finally {
      setLoadingInit(false)
    }
  }

  const loadSiswaRaw = async (kelasIds = waliKelasIds) => {
    let query = supabase
      .from('profiles')
      .select('*')
      .eq('role', 'siswa')

    if (Array.isArray(kelasIds) && kelasIds.length) {
      query = query.in('kelas', kelasIds)
    }

    const { data, error } = await query
      .order('kelas', { ascending: true })
      .order('nama', { ascending: true })

    if (error) throw error
    setSiswaRaw(data || [])
    setSiswa(data || [])
  }

  const loadKelasList = async (kelasIds = []) => {
    let query = supabase
      .from('kelas')
      .select('*')

    if (Array.isArray(kelasIds) && kelasIds.length) {
      query = query.in('id', kelasIds)
    }

    const { data, error } = await query
      .order('grade', { ascending: true })
      .order('suffix', { ascending: true })

    if (error) throw error
    setKelasList(data || [])
  }

  const loadStrukturKelas = async (kelasIds = []) => {
    let query = supabase
      .from('kelas_struktur')
      .select('*')

    if (Array.isArray(kelasIds) && kelasIds.length) {
      query = query.in('kelas_id', kelasIds)
    }

    const { data, error } = await query

    if (error) throw error

    const struktur = {}
    data?.forEach(item => { struktur[item.kelas_id] = item })
    setStrukturKelas(struktur)
  }

  // Opsi kelas untuk Select
  const kelasOptions = useMemo(() => {
    return kelasList.map(kelas => ({
      value: kelas.id,
      label: getKelasDisplayName(kelas),
      grade: kelas.grade
    }))
  }, [kelasList])

  const kelasFilterOptions = useMemo(() => {
    const mapped = kelasOptions.map(k => ({ value: k.value, label: k.label }))

    if (isGuru) {
      if (mapped.length <= 1) return mapped
      return [{ value: '', label: 'Semua Kelas Ampuan' }, ...mapped]
    }

    return [{ value: '', label: 'Semua Kelas' }, ...mapped]
  }, [isGuru, kelasOptions])

  const kelasFilterValueSet = useMemo(
    () => new Set(kelasFilterOptions.map(opt => String(opt.value ?? ''))),
    [kelasFilterOptions]
  )

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

  const getNamaKelas = (kelasId) => {
    const kelas = kelasList.find(k => k.id === kelasId)
    return getKelasDisplayName(kelas) || kelasId || '—'
  }

  // Cek ketua kelas
  const isKetuaKelas = (siswaId) => {
    return Object.values(strukturKelas).some(
      struktur => struktur.ketua_siswa_id === siswaId
    )
  }

  const getKelasKetua = (siswaId) => {
    const struktur = Object.values(strukturKelas).find(
      s => s.ketua_siswa_id === siswaId
    )
    return struktur ? getNamaKelas(struktur.kelas_id) : null
  }

  useEffect(() => {
    if (!isGuru) return

    const onlyKelas = kelasOptions.length === 1 ? (kelasOptions[0]?.value || '') : ''
    const shouldUseSingleKelas = Boolean(onlyKelas)

    if (qKelas && !kelasFilterValueSet.has(String(qKelas))) {
      setQKelas(shouldUseSingleKelas ? onlyKelas : '')
      return
    }

    if (!qKelas && shouldUseSingleKelas) {
      setQKelas(onlyKelas)
    }
  }, [isGuru, kelasOptions, kelasFilterValueSet, qKelas])

  const normalizeImportRow = (row, index) => {
    const mapped = mapRowByAliases(row, SISWA_ALIAS_MAP)
    const hasAny = Object.values(mapped).some((v) => String(v || '').trim() !== '')
    if (!hasAny) return null

    const kelasRaw = toText(mapped.kelas).toUpperCase()
    const resolvedKelas = resolveKelasId(kelasRaw)
    const tanggalLahir = parseDateValue(mapped.tanggal_lahir)

    const telpRaw = toText(mapped.telp)
    const noHpSiswaRaw = toText(mapped.no_hp_siswa || mapped.telp)
    const noHpWaliRaw = toText(mapped.no_hp_wali)

    return {
      __rowNum: index + 2,
      nama: toText(mapped.nama),
      nis: toText(mapped.nis),
      kelas: resolvedKelas,
      kelas_raw: kelasRaw,
      jk: normalizeGender(mapped.jk),
      tanggal_lahir: tanggalLahir,
      usia: calculateAgeFromIsoDate(tanggalLahir),
      agama: toText(mapped.agama),
      alamat: toText(mapped.alamat),
      telp: telpRaw ? normalizePhoneID(telpRaw) : '',
      no_hp_siswa: noHpSiswaRaw ? normalizePhoneID(noHpSiswaRaw) : '',
      no_hp_wali: noHpWaliRaw ? normalizePhoneID(noHpWaliRaw) : '',
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
          reason: 'NIS dan Nama wajib diisi'
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
    setImportHistories([])
    setImportHistoryItems([])
    setSelectedImportHistory(null)
    setImportHistoryLoading(false)
    setImportHistoryDetailLoading(false)
    setImportHistoryActionLoading(false)
    setImportSource('file')
  }

  const loadImportHistoryItems = async (historyId) => {
    if (!historyId) {
      setImportHistoryItems([])
      return []
    }

    setImportHistoryDetailLoading(true)
    try {
      const { data, error } = await supabase
        .from('import_siswa_history_items')
        .select('*')
        .eq('history_id', historyId)
        .order('id', { ascending: true })

      if (error) throw error
      const rows = data || []
      setImportHistoryItems(rows)
      return rows
    } catch (error) {
      console.error('Error loading import history detail:', error)
      pushToast('error', `Gagal memuat detail riwayat: ${error?.message || 'Unknown error'}`)
      setImportHistoryItems([])
      return []
    } finally {
      setImportHistoryDetailLoading(false)
    }
  }

  const loadImportHistories = async (preferredId = null) => {
    setImportHistoryLoading(true)
    try {
      const { data, error } = await supabase
        .from('import_siswa_histories')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error
      const rows = data || []
      setImportHistories(rows)

      const target =
        rows.find((item) => item.id === preferredId) ||
        rows.find((item) => item.id === selectedImportHistory?.id) ||
        rows[0] ||
        null

      setSelectedImportHistory(target)
      if (target?.id) {
        await loadImportHistoryItems(target.id)
      } else {
        setImportHistoryItems([])
      }
    } catch (error) {
      console.error('Error loading import histories:', error)
      pushToast('error', `Gagal memuat riwayat import: ${error?.message || 'Unknown error'}`)
    } finally {
      setImportHistoryLoading(false)
    }
  }

  const switchImportSource = async (nextSource) => {
    setImportSource(nextSource)
    if (nextSource === 'history') {
      await loadImportHistories()
    }
  }

  const openImportHistory = async (history) => {
    if (!history?.id) return
    setSelectedImportHistory(history)
    await loadImportHistoryItems(history.id)
  }

  const saveSelectedImportHistory = async () => {
    if (!selectedImportHistory?.id) return

    setImportHistoryActionLoading(true)
    try {
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('import_siswa_histories')
        .update({
          status: 'saved',
          saved_at: now,
          updated_at: now
        })
        .eq('id', selectedImportHistory.id)

      if (error) throw error

      pushToast('success', 'Riwayat import disimpan')
      await loadImportHistories(selectedImportHistory.id)
    } catch (error) {
      console.error('Error saving import history:', error)
      pushToast('error', `Gagal menyimpan riwayat: ${error?.message || 'Unknown error'}`)
    } finally {
      setImportHistoryActionLoading(false)
    }
  }

  const deleteSelectedImportHistory = async () => {
    if (!selectedImportHistory?.id) return

    const ok = window.confirm(
      'Hapus riwayat import ini? Akun siswa yang dibuat dari batch ini juga akan ikut dihapus.'
    )
    if (!ok) return

    setImportHistoryActionLoading(true)
    try {
      let items = importHistoryItems
      if (!items.length) {
        items = await loadImportHistoryItems(selectedImportHistory.id)
      }

      const createdProfileIds = [...new Set(
        (items || [])
          .filter((item) => item.created_user && item.profile_id)
          .map((item) => item.profile_id)
      )]

      let deletedUsers = 0
      let failedUsers = 0
      for (const profileId of createdProfileIds) {
        // eslint-disable-next-line no-await-in-loop
        const { error: deleteUserError } = await supabase.admin.deleteUser(profileId)
        if (deleteUserError) {
          failedUsers += 1
          console.warn('Failed deleting imported user:', profileId, deleteUserError)
        } else {
          deletedUsers += 1
        }
      }

      const { error: deleteItemsError } = await supabase
        .from('import_siswa_history_items')
        .delete()
        .eq('history_id', selectedImportHistory.id)
      if (deleteItemsError) throw deleteItemsError

      const { error: deleteHistoryError } = await supabase
        .from('import_siswa_histories')
        .delete()
        .eq('id', selectedImportHistory.id)
      if (deleteHistoryError) throw deleteHistoryError

      pushToast(
        'success',
        `Riwayat dihapus. Akun siswa terhapus: ${deletedUsers}${failedUsers ? `, gagal: ${failedUsers}` : ''}`
      )

      await loadImportHistories()
      await loadSiswaRaw()
    } catch (error) {
      console.error('Error deleting import history:', error)
      pushToast('error', `Gagal menghapus riwayat: ${error?.message || 'Unknown error'}`)
    } finally {
      setImportHistoryActionLoading(false)
    }
  }

  const persistImportHistory = async (summary, itemRows) => {
    const now = new Date().toISOString()
    const historyId = createClientUuid()

    const historyPayload = {
      id: historyId,
      admin_id: user?.id || null,
      source: importSource === 'sheet' ? 'sheet' : 'file',
      file_name: importSource === 'file' ? (importFile?.name || null) : null,
      sheet_url: importSource === 'sheet' ? (sheetUrl.trim() || null) : null,
      status: 'pending',
      total_rows: importRows.length,
      success_rows: summary.created + summary.updated + summary.skipped,
      created_rows: summary.created,
      updated_rows: summary.updated,
      skipped_rows: summary.skipped,
      failed_rows: summary.failed,
      saved_at: null,
      created_at: now,
      updated_at: now
    }

    const { error: historyError } = await supabase
      .from('import_siswa_histories')
      .insert(historyPayload)

    if (historyError) throw historyError

    if (itemRows.length) {
      const withHeader = itemRows.map((item) => ({
        ...item,
        history_id: historyId,
        imported_at: item.imported_at || now,
        created_at: now,
        updated_at: now
      }))

      const { error: itemError } = await supabase
        .from('import_siswa_history_items')
        .insert(withHeader)

      if (itemError) throw itemError
    }

    return historyId
  }

  const upsertSiswaRow = async (row) => {
    const nis = row.nis
    const nama = row.nama
    const emailLower = row.email ? row.email.toLowerCase() : ''
    const hasEmail = isEmailFormat(emailLower)
    const emailForAuth = hasEmail ? emailLower : `${nis}@import.local`
    const isPlaceholderEmail = (value) => /@import\.local$/i.test(String(value || '').trim())
    const password = buildDefaultPassword(row.tanggal_lahir, nis)

    let { data: existing, error: exError } = await supabase
      .from('profiles')
      .select('id, role, email, nis')
      .eq('nis', nis)
      .maybeSingle()

    if (exError) throw exError

    if (!existing && hasEmail) {
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
    if (row.kelas) payload.kelas = row.kelas
    if (row.jk) payload.jk = row.jk
    if (row.tanggal_lahir) payload.tanggal_lahir = row.tanggal_lahir
    if (Number.isInteger(row.usia) && row.usia >= 0) payload.usia = row.usia
    if (row.agama) payload.agama = row.agama
    if (row.alamat) payload.alamat = row.alamat
    if (row.telp) payload.telp = row.telp
    if (row.no_hp_siswa) payload.no_hp_siswa = row.no_hp_siswa
    if (row.no_hp_wali) payload.no_hp_wali = row.no_hp_wali
    if (row.status) payload.status = row.status

    if (existing?.id) {
      if (existing.role && existing.role !== 'siswa') {
        throw new Error('NIS sudah digunakan untuk role lain')
      }

      const existingEmail = String(existing.email || '').trim().toLowerCase()
      if (hasEmail) {
        payload.email = emailLower
      } else if (!existingEmail || isPlaceholderEmail(existingEmail)) {
        payload.email = emailForAuth
      }

      const updateKeys = Object.keys(payload).filter((k) => k !== 'updated_at')
      if (!updateKeys.length) {
        return {
          status: 'skipped',
          profileId: existing.id
        }
      }

      const { error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', existing.id)

      if (error) throw error
      return {
        status: 'updated',
        profileId: existing.id
      }
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: emailForAuth,
      password,
      options: {
        data: {
          nama,
          role: 'siswa'
        }
      }
    })

    if (authError) throw authError
    const userId = authData?.user?.id
    if (!userId) throw new Error('User gagal dibuat')

    const createPayload = {
      ...payload,
      role: 'siswa',
      email: emailForAuth,
      status: payload.status || 'active',
      must_change_password: true
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update(createPayload)
      .eq('id', userId)

    if (updateError) throw updateError

    return {
      status: 'created',
      profileId: userId
    }
  }

  const handleRunImport = async () => {
    if (!importRows.length) {
      pushToast('error', 'Tidak ada data untuk diimport')
      return
    }

    if (!kelasList.length) {
      pushToast('error', 'Belum ada data kelas. Buat kelas terlebih dahulu sebelum import siswa.')
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
    const historyItems = []

    for (const row of importRows) {
      try {
        const result = await upsertSiswaRow(row)
        if (result?.status === 'created') summary.created += 1
        else if (result?.status === 'updated') summary.updated += 1
        else summary.skipped += 1

        historyItems.push({
          profile_id: result?.profileId || null,
          status: result?.status || 'skipped',
          created_user: result?.status === 'created',
          nis: row.nis || null,
          nama: row.nama || null,
          kelas: row.kelas_raw || row.kelas || null,
          error_message: null,
          imported_at: new Date().toISOString()
        })
      } catch (error) {
        summary.failed += 1
        const reason = error?.message || 'Gagal memproses'
        summary.errors.push({
          row: row.__rowNum,
          reason
        })
        historyItems.push({
          profile_id: null,
          status: 'failed',
          created_user: false,
          nis: row.nis || null,
          nama: row.nama || null,
          kelas: row.kelas_raw || row.kelas || null,
          error_message: reason,
          imported_at: new Date().toISOString()
        })
      }
    }

    let historyId = null
    try {
      historyId = await persistImportHistory(summary, historyItems)
    } catch (error) {
      console.error('Error saving import history:', error)
      pushToast('warning', `Import selesai, tapi gagal menyimpan riwayat: ${error?.message || 'Unknown error'}`)
    }

    setImportSummary({
      ...summary,
      historyId
    })
    setImportLoading(false)
    await loadSiswaRaw()

    if (historyId) {
      setImportSource('history')
      await loadImportHistories(historyId)
    }
  }

  const exportSiswaToExcel = () => {
    const rows = siswa.map((item, idx) => ({
      No: idx + 1,
      NIS: item.nis || '',
      Nama: item.nama || '',
      Kelas: getNamaKelas(item.kelas),
      JK: item.jk || '',
      'Tanggal Lahir': item.tanggal_lahir || '',
      Agama: item.agama || '',
      Alamat: item.alamat || '',
      'HP Siswa': item.no_hp_siswa || item.telp || '',
      'HP Wali': item.no_hp_wali || '',
      Email: item.email || '',
      Status: item.status || 'active'
    }))

    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Siswa')
    const stamp = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(workbook, `siswa_${stamp}.xlsx`)
  }

  /* ===== Statistik dashboard ===== */
  const stats = useMemo(() => {
    const totalSiswa = siswaRaw.length
    const aktifSiswa = siswaRaw.filter(s => (s.status || 'active') === 'active').length
    const nonaktifOnly = siswaRaw.filter(s => s.status === 'nonaktif' || s.status === 'inactive').length
    const mutasiSiswa = siswaRaw.filter(s => s.status === 'mutasi').length
    const alumniSiswa = siswaRaw.filter(s => s.status === 'alumni').length
    const nonaktifSiswa = totalSiswa - aktifSiswa
    const ketuaKelas = siswaRaw.filter(s => isKetuaKelas(s.id)).length

    return {
      totalSiswa,
      aktifSiswa,
      nonaktifSiswa,
      nonaktifOnly,
      mutasiSiswa,
      alumniSiswa,
      ketuaKelas
    }
  }, [siswaRaw, strukturKelas])

  /* ===== Filter (debounced, fix logic) ===== */
  const applyFilterNow = () => {
    const namaNeedle = qNama.trim().toLowerCase()
    const nikNeedle = qNIS.trim().toLowerCase()
    const kelasNeedle = qKelas
    const hasRfidNeedle = qHasRfid
    const statusNeedle = qStatus

    const res = siswaRaw.filter(s => {
      const okNama = namaNeedle
        ? (String(s.nama || '').toLowerCase().includes(namaNeedle) ||
          String(s.email || '').toLowerCase().includes(namaNeedle))
        : true

      const okNik = nikNeedle
        ? (String(s.nis || '').toLowerCase().includes(nikNeedle))
        : true

      const okKls = kelasNeedle
        ? String(s.kelas || '') === kelasNeedle
        : true

      const hasRfid = !!s.rfid_uid
      const okRfid =
        hasRfidNeedle === ''
          ? true
          : hasRfidNeedle === 'yes'
            ? hasRfid
            : !hasRfid

      const currentStatus = s.status || 'active'
      const okStatus = statusNeedle === ''
        ? true
        : currentStatus === statusNeedle

      return okNama && okNik && okKls && okRfid && okStatus
    })

    setSiswa(res)
  }

  function applyFilter() {
    setIsSearching(true)
    applyFilterNow()
    setIsSearching(false)
  }

  function resetFilter() {
    setQNama('')
    setQNIS('')
    if (isGuru && kelasOptions.length === 1) {
      setQKelas(kelasOptions[0]?.value || '')
    } else {
      setQKelas('')
    }
    setQHasRfid('')
    setQStatus('')
    setSiswa(siswaRaw)
  }

  useEffect(() => {
    if (filterTimerRef.current) clearTimeout(filterTimerRef.current)
    setIsSearching(true)
    filterTimerRef.current = setTimeout(() => {
      applyFilterNow()
      setIsSearching(false)
    }, 250)
    return () => {
      if (filterTimerRef.current) clearTimeout(filterTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qNama, qNIS, qKelas, qHasRfid, qStatus, siswaRaw])

  /* ===== Grade helpers ===== */
  const DEFAULT_GRADES = ['VII', 'VIII', 'IX', 'X', 'XI', 'XII']
  const gradeLabels = useMemo(() => {
    const s = new Set(DEFAULT_GRADES)
    for (const k of kelasList) {
      const g = getGradeLabel(k.id)
      if (g) s.add(g)
    }
    const order = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
    return [...s].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  }, [kelasList])

  function kelasByGrade(g) {
    const G = canonGrade(g)
    if (!G) return []
    return kelasList.filter(k => getGradeLabel(k.id) === G)
  }

  /* ===== Kandidat & pilihan siswa di modal kenaikan kelas ===== */
  const promotionCandidateSiswa = useMemo(() => {
    let list = siswaRaw

    if (promotionFilterGrade) {
      list = list.filter(s => getGradeLabel(s.kelas || '') === promotionFilterGrade)
    }

    if (promotionFilterKelas) {
      list = list.filter(s => s.kelas === promotionFilterKelas)
    }

    return [...list].sort((a, b) => {
      const kelasA = getNamaKelas(a.kelas)
      const kelasB = getNamaKelas(b.kelas)
      if (kelasA !== kelasB) return kelasA.localeCompare(kelasB)
      return (a.nama || '').localeCompare(b.nama || '')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siswaRaw, promotionFilterGrade, promotionFilterKelas, kelasList])

  const togglePromotionSelect = (id) => {
    setPromotionSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const togglePromotionSelectAllVisible = () => {
    const visibleIds = promotionCandidateSiswa.map(s => s.id)
    if (!visibleIds.length) return

    const allSelected = visibleIds.every(id => promotionSelectedIds.includes(id))
    if (allSelected) {
      setPromotionSelectedIds(prev => prev.filter(id => !visibleIds.includes(id)))
    } else {
      setPromotionSelectedIds(prev => [...new Set([...prev, ...visibleIds])])
    }
  }

  const openPromotionModal = () => {
    openPasswordModal(
      'Fitur Kenaikan Kelas',
      () => {
        setPromotionMode('kelas')
        setPromotionFromKelas('')
        setPromotionToKelas('')
        setPromotionFilterGrade('')
        setPromotionFilterKelas('')
        setPromotionSelectedIds([])
        setPromotionAlumniYear(String(new Date().getFullYear()))
        setPromotionExitReason('')
        setPromotionModalOpen(true)
      }
    )
  }

  const closePromotionModal = () => {
    setPromotionModalOpen(false)
    setPromotionLoading(false)
    setPromotionFromKelas('')
    setPromotionToKelas('')
    setPromotionFilterGrade('')
    setPromotionFilterKelas('')
    setPromotionSelectedIds([])
    setPromotionExitReason('')
    setPromotionAlumniYear(String(new Date().getFullYear()))
  }

  const handlePromotion = async () => {
    try {
      if (!promotionToKelas) {
        pushToast('error', 'Pilih kelas tujuan terlebih dahulu')
        return
      }

      if (promotionMode === 'kelas') {
        if (!promotionFromKelas) {
          pushToast('error', 'Pilih kelas asal terlebih dahulu')
          return
        }
        const isExit = [PROMO_ALUMNI, PROMO_MUTASI].includes(promotionToKelas)
        if (!isExit && promotionFromKelas === promotionToKelas) {
          pushToast('error', 'Kelas asal dan tujuan tidak boleh sama')
          return
        }
      } else {
        if (!promotionSelectedIds.length) {
          pushToast('error', 'Pilih minimal 1 siswa untuk dipindahkan')
          return
        }
      }

      // kumpulkan siswa & id sesuai mode
      let selectedSiswa = []
      let ids = []

      if (promotionMode === 'kelas') {
        selectedSiswa = siswaRaw.filter(s => s.kelas === promotionFromKelas)
        ids = selectedSiswa.map(s => s.id)
      } else {
        selectedSiswa = siswaRaw.filter(s => promotionSelectedIds.includes(s.id))
        ids = [...promotionSelectedIds]
      }

      if (!ids.length) {
        pushToast('error', 'Tidak ada siswa yang bisa diproses')
        return
      }

      const isAlumniMode = promotionToKelas === PROMO_ALUMNI
      const isMutasiMode = promotionToKelas === PROMO_MUTASI
      const isExitMode = isAlumniMode || isMutasiMode

      const fromKelasName = promotionMode === 'kelas' ? getNamaKelas(promotionFromKelas) : null
      const toKelasName = !isExitMode ? getNamaKelas(promotionToKelas) : null

      // Build confirm message (FIX: sebelumnya broken string & brace)
      const lines = []

      if (isExitMode) {
        const modeLabel = isAlumniMode ? 'ALUMNI (Lulus)' : 'MUTASI (Pindah Sekolah)'
        lines.push(`Anda akan memproses status ${modeLabel} untuk ${ids.length} siswa.`)
        lines.push('')

        lines.push(
          promotionMode === 'kelas'
            ? `Sumber: kelas "${fromKelasName || promotionFromKelas}"`
            : 'Sumber: siswa terpilih (multi-kelas)'
        )

        if (isAlumniMode) {
          const eligible = selectedSiswa.filter(s => getGradeLabel(s.kelas) === 'XII')
          const skipped = ids.length - eligible.length
          const year = parseInt(promotionAlumniYear || '', 10) || new Date().getFullYear()

          lines.push('')
          lines.push('⚠️ Alumni otomatis hanya untuk siswa kelas XII.')
          lines.push(`Eligible: ${eligible.length}${skipped ? `, dilewati: ${skipped}` : ''}`)
          lines.push(`Tahun lulus: ${year}`)
        }

        if (!promotionExitReason.trim()) {
          pushToast('error', 'Isi alasan/catatan terlebih dahulu')
          return
        }

        lines.push('')
        lines.push(`Alasan/Catatan: ${promotionExitReason.trim()}`)
        lines.push('')
        lines.push('Lanjutkan?')
      } else {
        // Normal pindah kelas
        if (promotionMode === 'kelas') {
          lines.push(
            `Anda akan memindahkan semua siswa dari kelas "${fromKelasName || promotionFromKelas}"`,
            `ke kelas "${toKelasName || promotionToKelas}".`,
            '',
            `Total siswa: ${ids.length}`
          )
        } else {
          lines.push(
            `Anda akan memindahkan ${ids.length} siswa terpilih`,
            `ke kelas "${toKelasName || promotionToKelas}".`
          )
        }

        // warning lintas grade
        const fromGrade =
          promotionMode === 'kelas'
            ? getGradeLabel(promotionFromKelas)
            : (() => {
              // kalau selected mode, tampilkan jika campur grade tidak warn
              const uniqueFromGrades = [...new Set(selectedSiswa.map(s => getGradeLabel(s.kelas)).filter(Boolean))]
              return uniqueFromGrades.length === 1 ? uniqueFromGrades[0] : ''
            })()

        const toGrade = getGradeLabel(promotionToKelas)

        if (fromGrade && toGrade && fromGrade !== toGrade) {
          lines.push('')
          lines.push('⚠️ PERHATIAN:')
          lines.push(`Ini termasuk pindah tingkatan (grade) dari ${fromGrade} ke ${toGrade}.`)
          lines.push('Pastikan ini memang kenaikan kelas / perbaikan salah kelas.')
        }

        lines.push('')
        lines.push('Lanjutkan?')
      }

      const confirmMsg = lines.join('\n')
      if (!window.confirm(confirmMsg)) return

      setPromotionLoading(true)
      const now = new Date().toISOString()

      if (isExitMode) {
        let eligibleSiswa = selectedSiswa
        if (isAlumniMode) {
          eligibleSiswa = selectedSiswa.filter(s => getGradeLabel(s.kelas) === 'XII')
        }

        if (!eligibleSiswa.length) {
          pushToast('error', 'Tidak ada siswa eligible untuk diproses (Alumni hanya kelas XII)')
          return
        }

        const eligibleIds = eligibleSiswa.map(s => s.id)

        // reset ketua kelas jika ketua ikut keluar
        await supabase
          .from('kelas_struktur')
          .update({ ketua_siswa_id: null, ketua_siswa_nama: null })
          .in('ketua_siswa_id', eligibleIds)

        const lastClassText = promotionMode === 'kelas'
          ? (fromKelasName || promotionFromKelas)
          : 'Multi-kelas'

        let alasan = ''
        if (isAlumniMode) {
          const year = parseInt(promotionAlumniYear || '', 10) || new Date().getFullYear()
          alasan = `Lulus tahun ${year}. Kelas terakhir: ${lastClassText}.`
        } else {
          alasan = `Mutasi/Pindah sekolah. Kelas terakhir: ${lastClassText}.`
        }
        if (promotionExitReason.trim()) alasan += ` ${promotionExitReason.trim()}`

        const payload = {
          status: isAlumniMode ? 'alumni' : 'mutasi',
          disabled_at: now,
          alasan_nonaktif: alasan,
          rfid_uid: null,
          kelas: ''
        }

        const { error } = await supabase
          .from('profiles')
          .update(payload)
          .in('id', eligibleIds)

        if (error) throw error

        const skipped = ids.length - eligibleIds.length
        pushToast('success', `${isAlumniMode ? 'Kelulusan' : 'Mutasi'} berhasil: ${eligibleIds.length} siswa`)
        if (skipped) pushToast('info', `${skipped} siswa dilewati (bukan kelas XII)`)

        closePromotionModal()
        await loadAllData()
        return
      }

      // Normal pindah kelas
      const { error } = await supabase
        .from('profiles')
        .update({ kelas: promotionToKelas })
        .in('id', ids)

      if (error) throw error

      // FIX: reset ketua kelas untuk semua kelas asal yg terdampak + kelas tujuan
      const affectedFrom = selectedSiswa.map(s => s.kelas).filter(Boolean)
      const affected = [...new Set([...affectedFrom, promotionToKelas].filter(Boolean))]
      if (affected.length) {
        await supabase
          .from('kelas_struktur')
          .update({ ketua_siswa_id: null, ketua_siswa_nama: null })
          .in('kelas_id', affected)
      }

      pushToast('success', `Berhasil memindahkan ${ids.length} siswa`)
      closePromotionModal()
      await loadAllData()
    } catch (error) {
      console.error('Error in handlePromotion:', error)
      pushToast('error', error.message || 'Gagal memproses kenaikan/pindah kelas')
    } finally {
      setPromotionLoading(false)
    }
  }

  /* ===== Detail modal ===== */
  const openDetail = async (u) => {
    setRfidInput((u.rfid_uid || '').toUpperCase())
    setRfidLastScan(null)
    setRfidEnrolling(false)
    if (rfidChannel) {
      try { supabase.removeChannel(rfidChannel) } catch {}
      setRfidChannel(null)
    }

    setDetailUser(u)
    setMoveKelas(u.kelas || '')
    setMoveGrade(getGradeLabel(u.kelas || '') || '')

    setEditPhoneForm({
      no_hp_siswa: u.no_hp_siswa || '',
      no_hp_wali: u.no_hp_wali || ''
    })
    setEditingPhone(false)

    // Untuk guru/wali: tampilkan detail segera dari data list, tanpa nunggu fetch tambahan.
    setDetailLoading(canManage)
    setDetailOpen(true)

    try {
      const { data: detailProfile, error: detailProfileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', u.id)
        .maybeSingle()

      if (detailProfileError) {
        console.warn('Warn loading profile detail (fallback row list):', detailProfileError)
      } else if (detailProfile) {
        setDetailUser(prev => ({
          ...(prev || {}),
          ...detailProfile
        }))
        setMoveKelas(detailProfile.kelas || '')
        setMoveGrade(getGradeLabel(detailProfile.kelas || '') || '')
        setEditPhoneForm({
          no_hp_siswa: detailProfile.no_hp_siswa || '',
          no_hp_wali: detailProfile.no_hp_wali || ''
        })
        setRfidInput((detailProfile.rfid_uid || '').toUpperCase())
      }

      const [orgRes, orgAnggotaRes, osisRes] = await Promise.allSettled([
        supabase.from('organisasi').select('*'),
        supabase.from('organisasi_anggota').select('*').eq('siswa_id', u.id),
        supabase.from('osis_anggota').select('*').eq('siswa_id', u.id).maybeSingle()
      ])

      let orgRows = []
      if (orgRes.status === 'fulfilled') {
        if (orgRes.value.error) {
          console.warn('Warn loading organisasi (fallback empty):', orgRes.value.error)
        } else {
          orgRows = orgRes.value.data || []
        }
      } else {
        console.warn('Warn loading organisasi (promise rejected):', orgRes.reason)
      }

      const all = orgRows.map(o => ({ id: o.id, nama: o.nama || o.id }))
      setOrgAll(all)

      let orgAnggotaRows = []
      if (orgAnggotaRes.status === 'fulfilled') {
        if (orgAnggotaRes.value.error) {
          console.warn('Warn loading organisasi_anggota (fallback empty):', orgAnggotaRes.value.error)
        } else {
          orgAnggotaRows = orgAnggotaRes.value.data || []
        }
      } else {
        console.warn('Warn loading organisasi_anggota (promise rejected):', orgAnggotaRes.reason)
      }

      const mine = orgAnggotaRows.map(a => ({
        orgId: a.organisasi_id,
        orgNama: all.find(o => o.id === a.organisasi_id)?.nama || a.organisasi_id,
        status: a.status || 'aktif',
        bagian: a.bagian || '',
        jabatan: a.jabatan || 'Anggota'
      }))
      setOrgMember(mine)

      let osisData = null
      if (osisRes.status === 'fulfilled') {
        if (osisRes.value.error) {
          console.warn('Warn loading osis_anggota (fallback empty):', osisRes.value.error)
        } else {
          osisData = osisRes.value.data || null
        }
      } else {
        console.warn('Warn loading osis_anggota (promise rejected):', osisRes.reason)
      }

      setOsisRow(
        osisData
          ? {
              status: osisData.status || 'aktif',
              bagian: osisData.bagian || '',
              jabatan: osisData.jabatan || 'Anggota'
            }
          : null
      )
    } catch (error) {
      console.error('Error loading detail:', error)
      pushToast('error', 'Gagal memuat detail siswa')
    } finally {
      setDetailLoading(false)
    }
  }

  // Auto pilih kelas ketika grade dipilih (detail modal)
  useEffect(() => {
    if (!detailOpen) return
    const currentGrade = getGradeLabel(detailUser?.kelas || '')
    if (currentGrade) return
    if (!moveGrade) return
    const opts = kelasByGrade(moveGrade)
    if (!opts.length) return
    if (!moveKelas) setMoveKelas(opts[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailOpen, moveGrade, kelasList, detailUser, moveKelas])

  function closeDetailModal() {
    setDetailOpen(false)
    setDetailUser(null)
    setRfidInput('')
    setRfidLastScan(null)
    setRfidEnrolling(false)
    setEditingPhone(false)
    setPhoneErrors({})
    if (rfidChannel) {
      try { supabase.removeChannel(rfidChannel) } catch {}
      setRfidChannel(null)
    }
  }

  /* ===== Detail: pindah kelas ===== */
  async function simpanPindahKelas() {
    const user = detailUser
    const target = moveKelas || ''
    if (!user || !target) return

    const originalGrade = getGradeLabel(user.kelas || '')
    const targetGrade = getGradeLabel(target || '')
    const isCrossGrade = originalGrade && targetGrade && originalGrade !== targetGrade

    const konfirmasi = window.confirm(
      `Yakin ingin mengubah kelas siswa?\n\n` +
      `Siswa : ${user.nama}\n` +
      `Dari   : ${getNamaKelas(user.kelas) || 'Tidak ada kelas'} (${originalGrade || '-'})\n` +
      `Ke     : ${getNamaKelas(target)} (${targetGrade || '-'})\n\n` +
      `Dampak perubahan:\n` +
      `• Data absensi SELANJUTNYA akan mengikuti kelas baru\n` +
      `• Data organisasi tetap sama\n` +
      `• Data tugas dan nilai tetap sama\n` +
      `• Status ketua kelas akan direset jika ada` +
      (isCrossGrade
        ? `\n\n⚠️ PERHATIAN:\n` +
          `Ini termasuk pindah tingkatan (grade) dari ${originalGrade} ke ${targetGrade}.\n` +
          `Pastikan ini memang kenaikan kelas / perbaikan salah kelas.`
        : '')
    )

    if (!konfirmasi) return

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ kelas: target })
        .eq('id', user.id)

      if (error) throw error

      if (isKetuaKelas(user.id)) {
        const strukturLama = Object.values(strukturKelas).find(
          s => s.ketua_siswa_id === user.id
        )
        if (strukturLama) {
          await supabase
            .from('kelas_struktur')
            .update({ ketua_siswa_id: null, ketua_siswa_nama: null })
            .eq('kelas_id', strukturLama.kelas_id)
        }
      }

      pushToast('success', 'Kelas berhasil diupdate')
      setDetailUser(prev => prev ? ({ ...prev, kelas: target }) : prev)
      loadSiswaRaw()
      loadStrukturKelas()
    } catch (error) {
      console.error('Error updating kelas:', error)
      pushToast('error', 'Gagal mengupdate kelas')
    }
  }

  async function kosongkanKelas() {
    const user = detailUser
    if (!user) return
    if (!window.confirm(`Yakin mau dikosongkan kelas untuk ${user.nama || user.email || user.id}?`)) return

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ kelas: '' })
        .eq('id', user.id)

      if (error) throw error

      pushToast('success', 'Kelas berhasil dikosongkan')
      setMoveKelas('')
      setDetailUser(prev => prev ? ({ ...prev, kelas: '' }) : prev)
      loadSiswaRaw()
    } catch (error) {
      console.error('Error clearing kelas:', error)
      pushToast('error', 'Gagal mengosongkan kelas')
    }
  }

  /* ===== Edit Nomor HP ===== */
  const handleEditPhone = () => setEditingPhone(true)

  const handleCancelEditPhone = () => {
    setEditingPhone(false)
    setEditPhoneForm({
      no_hp_siswa: detailUser?.no_hp_siswa || '',
      no_hp_wali: detailUser?.no_hp_wali || ''
    })
    setPhoneErrors({})
  }

  const handlePhoneChange = (e) => {
    const { name, value } = e.target
    setEditPhoneForm(prev => ({ ...prev, [name]: value }))
    if (phoneErrors[name]) setPhoneErrors(prev => ({ ...prev, [name]: '' }))
  }

  const handleSavePhone = async () => {
    const errors = {}
    const noHpSiswaError = validatePhoneNumber(editPhoneForm.no_hp_siswa, 'HP Siswa')
    const noHpWaliError = validatePhoneNumber(editPhoneForm.no_hp_wali, 'HP Wali')

    if (noHpSiswaError) errors.no_hp_siswa = noHpSiswaError
    if (noHpWaliError) errors.no_hp_wali = noHpWaliError

    if (Object.keys(errors).length > 0) {
      setPhoneErrors(errors)
      return
    }

    const normalizedSiswa = editPhoneForm.no_hp_siswa ? normalizePhoneID(editPhoneForm.no_hp_siswa) : null
    const normalizedWali = editPhoneForm.no_hp_wali ? normalizePhoneID(editPhoneForm.no_hp_wali) : null

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          no_hp_siswa: normalizedSiswa,
          no_hp_wali: normalizedWali,
          updated_at: new Date().toISOString()
        })
        .eq('id', detailUser.id)

      if (error) throw error

      pushToast('success', 'Nomor HP berhasil diperbarui')
      setDetailUser(prev => prev ? ({
        ...prev,
        no_hp_siswa: normalizedSiswa,
        no_hp_wali: normalizedWali
      }) : prev)

      setSiswaRaw(prev => prev.map(s =>
        s.id === detailUser.id
          ? { ...s, no_hp_siswa: normalizedSiswa, no_hp_wali: normalizedWali }
          : s
      ))
      setSiswa(prev => prev.map(s =>
        s.id === detailUser.id
          ? { ...s, no_hp_siswa: normalizedSiswa, no_hp_wali: normalizedWali }
          : s
      ))

      setEditingPhone(false)
      setPhoneErrors({})
    } catch (error) {
      console.error('Error saving phone numbers:', error)
      pushToast('error', 'Gagal menyimpan nomor HP')
    }
  }

  /* ===== Nonaktifkan & Aktifkan ===== */
  const openNonaktifModal = (siswa) => {
    openPasswordModal(
      'Konfirmasi Nonaktifkan Siswa',
      () => {
        setSiswaToNonaktif(siswa)
        setAlasanNonaktif('')
        setNonaktifModalOpen(true)
      }
    )
  }

  const openAktifkanModal = (siswa) => {
    openPasswordModal(
      'Konfirmasi Aktifkan Siswa',
      () => {
        setSiswaToAktifkan(siswa)
        setAktifkanModalOpen(true)
      }
    )
  }

  const nonaktifkanSiswa = () => {
    if (!siswaToNonaktif) return
    if (!alasanNonaktif.trim()) {
      pushToast('error', 'Harap masukkan alasan penonaktifan')
      return
    }

    openPasswordModal(
      'Konfirmasi Akhir Nonaktifkan Siswa',
      async () => {
        try {
          const { error } = await supabase
            .from('profiles')
            .update({
              status: 'nonaktif',
              alasan_nonaktif: alasanNonaktif.trim(),
              disabled_at: new Date().toISOString()
            })
            .eq('id', siswaToNonaktif.id)

          if (error) throw error

          pushToast('success', 'Siswa berhasil dinonaktifkan')

          if (detailUser && detailUser.id === siswaToNonaktif.id) {
            setDetailUser(prev => prev ? ({
              ...prev,
              status: 'nonaktif',
              alasan_nonaktif: alasanNonaktif.trim()
            }) : prev)
          }

          setNonaktifModalOpen(false)
          setAlasanNonaktif('')
          setSiswaToNonaktif(null)
          loadSiswaRaw()
        } catch (error) {
          console.error('Error nonaktifkan siswa:', error)
          pushToast('error', 'Gagal menonaktifkan siswa')
        }
      }
    )
  }

  const aktifkanSiswa = () => {
    if (!siswaToAktifkan) return

    openPasswordModal(
      'Konfirmasi Akhir Aktifkan Siswa',
      async () => {
        try {
          const { error } = await supabase
            .from('profiles')
            .update({
              status: 'active',
              alasan_nonaktif: null,
              disabled_at: null
            })
            .eq('id', siswaToAktifkan.id)

          if (error) throw error

          pushToast('success', 'Siswa berhasil diaktifkan')

          if (detailUser && detailUser.id === siswaToAktifkan.id) {
            setDetailUser(prev => prev ? ({
              ...prev,
              status: 'active',
              alasan_nonaktif: null
            }) : prev)
          }

          setAktifkanModalOpen(false)
          setSiswaToAktifkan(null)
          loadSiswaRaw()
        } catch (error) {
          console.error('Error mengaktifkan siswa:', error)
          pushToast('error', 'Gagal mengaktifkan siswa')
        }
      }
    )
  }

  /* ===== RFID ===== */
  function toggleRfidListen() {
    if (!canManageRfid) return

    if (rfidEnrolling) {
      if (rfidChannel) {
        try { supabase.removeChannel(rfidChannel) } catch {}
        setRfidChannel(null)
      }
      setRfidEnrolling(false)
      pushToast('info', 'Mode scan RFID dimatikan')
      return
    }

    const channel = supabase
      .channel('rfid-scans-detail')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rfid_scans' },
        (payload) => {
          const uid = (payload.new.card_uid || '').toUpperCase().replace(/\s+/g, '')
          setRfidInput(uid)
          setRfidLastScan(payload.new)
          pushToast('success', `UID RFID terdeteksi: ${uid}`)
        }
      )
      .subscribe()

    setRfidChannel(channel)
    setRfidEnrolling(true)
    pushToast('info', 'Mode scan aktif. Silakan tap kartu di reader.')
  }

  async function saveRfid() {
    if (!canManageRfid) return
    if (!detailUser) return
    const raw = (rfidInput || '').trim()
    const cleaned = raw.toUpperCase().replace(/\s+/g, '')

    if (!cleaned) {
      pushToast('error', 'UID RFID tidak boleh kosong')
      return
    }

    if (!/^[0-9A-F]{8,14}$/.test(cleaned)) {
      pushToast('error', 'Format UID RFID tidak valid. Harus 8-14 karakter hexadecimal (0-9, A-F)')
      return
    }

    try {
      const { data: existingRows, error: exError } = await supabase
        .from('profiles')
        .select('id, nama, email')
        .eq('rfid_uid', cleaned)
        .neq('id', detailUser.id)

      if (exError) throw exError
      if (existingRows && existingRows.length > 0) {
        const other = existingRows[0]
        pushToast('error',
          `UID ${cleaned} sudah terdaftar untuk siswa:\n` +
          `${other.nama || 'Tanpa nama'} (${other.email || 'Tanpa email'})`
        )
        return
      }

      const { error } = await supabase
        .from('profiles')
        .update({ rfid_uid: cleaned })
        .eq('id', detailUser.id)

      if (error) throw error

      pushToast('success', 'UID RFID berhasil disimpan')
      setDetailUser(prev => prev ? { ...prev, rfid_uid: cleaned } : prev)
      setSiswaRaw(prev => prev.map(s => s.id === detailUser.id ? { ...s, rfid_uid: cleaned } : s))
      setSiswa(prev => prev.map(s => s.id === detailUser.id ? { ...s, rfid_uid: cleaned } : s))
    } catch (err) {
      console.error('Error saving RFID:', err)
      pushToast('error', 'Gagal menyimpan UID RFID')
    }
  }

  async function clearRfid() {
    if (!canManageRfid) return
    if (!detailUser) return
    if (!detailUser.rfid_uid && !rfidInput) return

    if (!window.confirm('Yakin ingin mengosongkan UID RFID untuk siswa ini?')) return

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ rfid_uid: null })
        .eq('id', detailUser.id)

      if (error) throw error

      pushToast('success', 'UID RFID dikosongkan')
      setRfidInput('')
      setDetailUser(prev => prev ? { ...prev, rfid_uid: null } : prev)
      setSiswaRaw(prev => prev.map(s => s.id === detailUser.id ? { ...s, rfid_uid: null } : s))
      setSiswa(prev => prev.map(s => s.id === detailUser.id ? { ...s, rfid_uid: null } : s))
    } catch (err) {
      console.error('Error clearing RFID:', err)
      pushToast('error', 'Gagal mengosongkan UID RFID')
    }
  }

  /* ===== Organisasi / OSIS ===== */
  async function hapusOrg(orgId) {
    const u = detailUser
    if (!u) return
    if (!window.confirm('Yakin mau dihapus dari organisasi ini?')) return

    try {
      const { error } = await supabase
        .from('organisasi_anggota')
        .delete()
        .eq('organisasi_id', orgId)
        .eq('siswa_id', u.id)

      if (error) throw error

      pushToast('success', 'Berhasil dihapus dari organisasi')
      setOrgMember(prev => prev.filter(x => x.orgId !== orgId))
    } catch (error) {
      console.error('Error deleting org:', error)
      pushToast('error', 'Gagal menghapus dari organisasi')
    }
  }

  async function hapusOsis() {
    const u = detailUser
    if (!u) return
    if (!window.confirm('Yakin mau dihapus dari OSIS?')) return

    try {
      const { error } = await supabase
        .from('osis_anggota')
        .delete()
        .eq('siswa_id', u.id)

      if (error) throw error

      pushToast('success', 'Berhasil dihapus dari OSIS')
      setOsisRow(null)
    } catch (error) {
      console.error('Error deleting OSIS:', error)
      pushToast('error', 'Gagal menghapus dari OSIS')
    }
  }

  /* ===== Hapus Akun Siswa ===== */
  function openDeleteConfirm(siswa) {
    setSiswaToDelete(siswa)
    setDeleteConfirmOpen(true)
  }

  function closeDeleteConfirm() {
    setDeleteConfirmOpen(false)
    setSiswaToDelete(null)
  }

  const hapusAkunSiswa = async () => {
    if (!siswaToDelete) return

    try {
      setDeletingSiswa(true)
      const { error } = await supabase.admin.deleteUser(siswaToDelete.id)
      if (error) throw error

      pushToast('success', 'Akun siswa berhasil dihapus permanen')

      closeDeleteConfirm()
      if (detailOpen) closeDetailModal()
      await loadAllData()
    } catch (error) {
      console.error('Error deleting siswa:', error)
      pushToast('error', 'Gagal menghapus akun siswa: ' + (error.message || 'Unknown error'))
    } finally {
      setDeletingSiswa(false)
    }
  }

  /* ===== Tambah Siswa ===== */
  const validateForm = () => {
    const errors = {}
    if (!form.email.trim()) errors.email = 'Email harus diisi'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = 'Format email tidak valid'

    if (!form.nama.trim()) errors.nama = 'Nama lengkap harus diisi'
    if (!form.password) errors.password = 'Password harus diisi'
    else if (form.password.length < 6) errors.password = 'Password minimal 6 karakter'
    if (form.password !== form.confirmPassword) errors.confirmPassword = 'Password dan konfirmasi tidak sama'
    if (form.nis && !/^\d+$/.test(form.nis)) errors.nis = 'NIS harus berupa angka'

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    if (formErrors[name]) setFormErrors(prev => ({ ...prev, [name]: '' }))
  }

  const resetForm = () => {
    setForm({
      email: '',
      nama: '',
      kelas: '',
      nis: '',
      jk: '',
      password: '',
      confirmPassword: ''
    })
    setFormErrors({})
  }

  const handleAdd = async () => {
    if (!validateForm()) return
    try {
      setAddingSiswa(true)

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        options: {
          data: {
            nama: form.nama.trim(),
            role: 'siswa'
          }
        }
      })

      if (authError) {
        if (authError.message?.toLowerCase().includes('already')) {
          throw new Error('Email sudah terdaftar')
        }
        throw authError
      }

      const { error } = await supabase.from('profiles').insert({
        id: authData.user.id,
        email: form.email.trim().toLowerCase(),
        nama: form.nama.trim(),
        kelas: form.kelas || '',
        nis: form.nis || '',
        jk: form.jk || '',
        role: 'siswa',
        status: 'active',
        created_at: new Date().toISOString(),
        no_hp_siswa: null,
        no_hp_wali: null
      })

      if (error) throw error

      pushToast('success', 'Siswa berhasil didaftarkan')
      resetForm()
      setShowAddForm(false)
      loadSiswaRaw()
    } catch (error) {
      console.error(error)
      pushToast('error', 'Gagal mendaftarkan siswa: ' + (error.message || 'Unknown error'))
    } finally {
      setAddingSiswa(false)
    }
  }

  /* ===========================
     Render
  ============================ */
  if (isWaliBlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-6">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <Card>
            <div className="p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Akses dibatasi</h2>
              <p className="text-gray-600">
                Halaman ini hanya tersedia untuk guru yang menjadi wali kelas.
              </p>
            </div>
          </Card>
        </div>
      </div>
    )
  }

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
                  <h3 className="text-lg font-bold text-gray-900">Import Data Siswa</h3>
                  <p className="text-sm text-gray-500">
                    Upload Excel/CSV atau Google Sheets untuk membuat akun siswa otomatis.
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
                    onClick={() => switchImportSource('file')}
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
                    onClick={() => switchImportSource('sheet')}
                  >
                    📊 Google Sheets
                  </button>
                  <button
                    type="button"
                    className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                      importSource === 'history'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-200'
                    }`}
                    onClick={() => switchImportSource('history')}
                  >
                    🕘 Riwayat Import
                  </button>
                </div>

                {importSource === 'history' ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-900">
                          Daftar Riwayat
                        </p>
                        <button
                          type="button"
                          onClick={() => loadImportHistories(selectedImportHistory?.id || null)}
                          className="text-xs px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                          disabled={importHistoryLoading || importHistoryActionLoading}
                        >
                          Refresh
                        </button>
                      </div>

                      <div className="max-h-80 overflow-auto divide-y divide-gray-100">
                        {importHistoryLoading ? (
                          <div className="p-4 text-sm text-gray-500">Memuat riwayat...</div>
                        ) : importHistories.length ? (
                          importHistories.map((history) => {
                            const isActive = selectedImportHistory?.id === history.id
                            const title = history.file_name || (history.source === 'sheet' ? 'Google Sheets' : 'Tanpa nama file')
                            const sourceLabel = IMPORT_SOURCE_LABEL[history.source] || history.source || 'Unknown'
                            const statusLabel = history.status === 'saved' ? 'Tersimpan' : 'Draft'
                            const statusClass = history.status === 'saved'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'

                            return (
                              <button
                                key={history.id}
                                type="button"
                                onClick={() => openImportHistory(history)}
                                className={`w-full text-left px-4 py-3 transition-colors ${
                                  isActive ? 'bg-blue-50' : 'hover:bg-gray-50'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-gray-900 truncate">{title}</p>
                                    <p className="text-xs text-gray-500">
                                      {sourceLabel} • {formatDate(history.created_at)}
                                    </p>
                                    <p className="text-xs text-gray-600 mt-1">
                                      Baru {history.created_rows || 0} • Update {history.updated_rows || 0} • Gagal {history.failed_rows || 0}
                                    </p>
                                  </div>
                                  <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${statusClass}`}>
                                    {statusLabel}
                                  </span>
                                </div>
                              </button>
                            )
                          })
                        ) : (
                          <div className="p-4 text-sm text-gray-500">Belum ada riwayat import.</div>
                        )}
                      </div>
                    </div>

                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                        <p className="text-sm font-semibold text-gray-900">
                          Detail Import
                        </p>
                      </div>

                      {!selectedImportHistory ? (
                        <div className="p-4 text-sm text-gray-500">
                          Pilih salah satu riwayat untuk melihat detail.
                        </div>
                      ) : (
                        <div className="p-4 space-y-3">
                          <div className="text-sm text-gray-700 space-y-1">
                            <p><span className="font-semibold">Sumber:</span> {IMPORT_SOURCE_LABEL[selectedImportHistory.source] || selectedImportHistory.source || 'Unknown'}</p>
                            <p><span className="font-semibold">File:</span> {selectedImportHistory.file_name || '—'}</p>
                            <p><span className="font-semibold">Dibuat:</span> {formatDate(selectedImportHistory.created_at)}</p>
                            <p><span className="font-semibold">Hasil:</span> Baru {selectedImportHistory.created_rows || 0} • Update {selectedImportHistory.updated_rows || 0} • Lewati {selectedImportHistory.skipped_rows || 0} • Gagal {selectedImportHistory.failed_rows || 0}</p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={saveSelectedImportHistory}
                              disabled={importHistoryActionLoading || selectedImportHistory.status === 'saved'}
                              className="px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Simpan
                            </button>
                            <button
                              type="button"
                              onClick={deleteSelectedImportHistory}
                              disabled={importHistoryActionLoading}
                              className="px-3 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              Hapus Import
                            </button>
                          </div>

                          <div className="text-xs text-gray-500">
                            Jika dihapus, akun siswa yang dibuat dari batch ini akan ikut dihapus.
                          </div>

                          <div className="border border-gray-200 rounded-lg overflow-hidden">
                            <div className="max-h-44 overflow-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-2 py-2 text-left font-semibold text-gray-600">NIS</th>
                                    <th className="px-2 py-2 text-left font-semibold text-gray-600">Nama</th>
                                    <th className="px-2 py-2 text-left font-semibold text-gray-600">Kelas</th>
                                    <th className="px-2 py-2 text-left font-semibold text-gray-600">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {importHistoryDetailLoading ? (
                                    <tr>
                                      <td colSpan="4" className="px-2 py-3 text-center text-gray-500">
                                        Memuat detail...
                                      </td>
                                    </tr>
                                  ) : importHistoryItems.length ? (
                                    importHistoryItems.map((item) => (
                                      <tr key={item.id} className="border-t border-gray-100">
                                        <td className="px-2 py-2">{item.nis || '—'}</td>
                                        <td className="px-2 py-2">{item.nama || '—'}</td>
                                        <td className="px-2 py-2">{getNamaKelas(item.kelas)}</td>
                                        <td className="px-2 py-2">
                                          <span className="font-semibold">{item.status}</span>
                                          {item.error_message ? (
                                            <p className="text-red-600 mt-0.5">{item.error_message}</p>
                                          ) : null}
                                        </td>
                                      </tr>
                                    ))
                                  ) : (
                                    <tr>
                                      <td colSpan="4" className="px-2 py-3 text-center text-gray-500">
                                        Tidak ada detail item.
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
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
                        <li>Kolom wajib: <b>Nama</b>, <b>NIS</b>, dan <b>Kelas</b>.</li>
                        <li>Password awal otomatis dari <b>tanggal lahir</b> (contoh 05/08/2010 → 05082010).</li>
                        <li>Usia akan dihitung otomatis dari tanggal lahir yang valid.</li>
                        <li>Login awal siswa: pakai <b>NIS</b> dan password tanggal lahir.</li>
                        <li>Nama kelas dari Excel harus sama dengan kelas yang sudah dibuat (otomatis dicocokkan uppercase).</li>
                        <li>Setelah login, siswa wajib ganti password. Jika email belum ada, isi email dulu.</li>
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
                        {importSummary.historyId ? (
                          <p className="mt-1 text-emerald-700">Riwayat tersimpan. Buka tab <b>Riwayat Import</b> untuk kelola batch ini.</p>
                        ) : null}
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
                  </>
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
                {importSource !== 'history' && (
                  <button
                    type="button"
                    onClick={handleRunImport}
                    disabled={importLoading || !importRows.length}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
                  >
                    {importLoading ? 'Memproses...' : 'Mulai Import'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <span className="text-2xl text-blue-600">👨‍🎓</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-1">Manajemen Siswa</h1>
                <p className="text-gray-600">
                  Kelola data siswa, kelas, organisasi, OSIS, dan kartu RFID
                </p>
                {isGuru && (
                  <p className="text-xs text-amber-700 mt-1">
                    Mode Wali Kelas: hanya lihat data siswa. Perubahan hanya untuk kartu RFID.
                  </p>
                )}
              </div>
            </div>

            {canManage && (
              <div className="mt-4 lg:mt-0 flex flex-col sm:flex-row gap-2">
                <button
                  className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-lg border border-emerald-200 hover:bg-emerald-100 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-all duration-200 font-medium"
                  onClick={exportSiswaToExcel}
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
                  className="bg-indigo-50 text-indigo-700 px-4 py-2 rounded-lg border border-indigo-200 hover:bg-indigo-100 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all duration-200 font-medium"
                  onClick={openPromotionModal}
                >
                  ⬆️ Kenaikan Kelas
                </button>
                <button
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 font-medium"
                  onClick={() => setShowAddForm(!showAddForm)}
                >
                  {showAddForm ? '✕ Tutup Form' : '➕ Tambah Siswa'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Dashboard Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Siswa"
            value={stats.totalSiswa}
            icon="👨‍🎓"
            color="blue"
            description="Semua siswa terdaftar"
          />
          <StatCard
            label="Siswa Aktif"
            value={stats.aktifSiswa}
            icon="✅"
            color="green"
            description="Sedang aktif belajar"
          />
          <StatCard
            label="Siswa Nonaktif"
            value={stats.nonaktifSiswa}
            icon="⏸️"
            color="orange"
            description={`Nonaktif: ${stats.nonaktifOnly} • Mutasi: ${stats.mutasiSiswa} • Alumni: ${stats.alumniSiswa}`}
          />
          <StatCard
            label="Ketua Kelas"
            value={stats.ketuaKelas}
            icon="👑"
            color="indigo"
            description="Siswa yang menjadi ketua"
          />
        </div>

        {/* Form Tambah Siswa */}
        {canManage && showAddForm && (
          <Card className="mb-6">
            <div className="bg-blue-50 border-b border-blue-200 p-4">
              <h3 className="text-lg font-semibold text-blue-900 flex items-center gap-2">
                <span>➕</span>
                Tambah Siswa Baru
              </h3>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Input
                  label="Email *"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="email@sekolah.sch.id"
                  type="email"
                  error={formErrors.email}
                  required
                />
                <Input
                  label="Nama Lengkap *"
                  name="nama"
                  value={form.nama}
                  onChange={handleChange}
                  placeholder="Nama lengkap siswa"
                  error={formErrors.nama}
                  required
                />
                <Select
                  label="Kelas"
                  name="kelas"
                  value={form.kelas}
                  onChange={handleChange}
                  options={[
                    { value: '', label: 'Pilih kelas' },
                    ...kelasOptions.map(k => ({ value: k.value, label: k.label }))
                  ]}
                />
                <Input
                  label="NIS"
                  name="nis"
                  value={form.nis}
                  onChange={handleChange}
                  placeholder="Nomor Induk Siswa"
                  error={formErrors.nis}
                />
                <Select
                  label="Jenis Kelamin"
                  name="jk"
                  value={form.jk}
                  onChange={handleChange}
                  options={[
                    { value: '', label: 'Pilih jenis kelamin' },
                    { value: 'L', label: 'Laki-laki' },
                    { value: 'P', label: 'Perempuan' }
                  ]}
                />
                <Input
                  label="Password *"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Password minimal 6 karakter"
                  type="password"
                  error={formErrors.password}
                  required
                />
                <Input
                  label="Konfirmasi Password *"
                  name="confirmPassword"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  placeholder="Ulangi password"
                  type="password"
                  error={formErrors.confirmPassword}
                  required
                />
              </div>

              <div className="flex justify-end space-x-3 mt-4 pt-4 border-t border-gray-200">
                <Button variant="secondary" onClick={resetForm}>🔄 Reset</Button>
                <Button variant="secondary" onClick={() => setShowAddForm(false)}>✕ Batal</Button>
                <Button
                  onClick={handleAdd}
                  loading={addingSiswa}
                  disabled={
                    !form.email ||
                    !form.nama ||
                    !form.password ||
                    form.password !== form.confirmPassword
                  }
                >
                  👨‍🎓 Daftarkan
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <Input
                label="Nama / Email"
                placeholder="Cari nama atau email"
                value={qNama}
                onChange={e => setQNama(e.target.value)}
              />
              <Input
                label="NIS"
                placeholder="Cari NIS"
                value={qNIS}
                onChange={e => setQNIS(e.target.value)}
              />
              <Select
                label="Kelas"
                value={qKelas}
                onChange={e => setQKelas(e.target.value)}
                options={kelasFilterOptions}
                disabled={isGuru && kelasOptions.length === 1}
              />
              <Select
                label="Status RFID"
                value={qHasRfid}
                onChange={e => setQHasRfid(e.target.value)}
                options={[
                  { value: '', label: 'Semua' },
                  { value: 'yes', label: 'Sudah punya RFID' },
                  { value: 'no', label: 'Belum punya RFID' }
                ]}
              />
              <Select
                label="Status Akun"
                value={qStatus}
                onChange={e => setQStatus(e.target.value)}
                options={[
                  { value: '', label: 'Semua Status' },
                  { value: 'active', label: 'Aktif' },
                  { value: 'nonaktif', label: 'Nonaktif' },
                  { value: 'mutasi', label: 'Mutasi (Pindah Sekolah)' },
                  { value: 'alumni', label: 'Alumni (Lulus)' }
                ]}
              />
            </div>
            <div className="flex justify-end space-x-3 mt-4">
              <Button onClick={applyFilter} loading={isSearching}>Cari</Button>
              <Button variant="secondary" onClick={resetFilter}>🔄 Reset</Button>
            </div>
          </div>
        </Card>

        {/* Tabel Siswa */}
        <Card>
          <div className="bg-gray-50 border-b border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <span>📊</span>
                Daftar Siswa
              </h3>
              <span className="text-sm text-gray-600">
                {siswa.length} dari {siswaRaw.length} siswa
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            {loadingInit ? (
              <div className="p-8 space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="animate-pulse flex space-x-4 items-center">
                    <div className="rounded-full bg-gray-200 h-10 w-10" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-3/4" />
                      <div className="h-3 bg-gray-200 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider border-b">No</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Siswa</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Kelas</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">NIS</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">JK</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">RFID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
                      {canManage ? 'Aksi' : 'Detail'}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {siswa.map((s, index) => {
                    const foto = s.photo_path || s.photo_url || s.foto_url || s.foto || ''
                    const isKetua = isKetuaKelas(s.id)

                    return (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-center">{index + 1}</td>

                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10">
                              <ProfileAvatar
                                src={foto}
                                name={s.nama}
                                size={40}
                                className="border-gray-200"
                                fallbackClassName="rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-sm font-medium text-blue-600"
                              />
                            </div>
                            <div className="ml-3">
                              <div className="text-sm font-medium text-gray-900">
                                {s.nama || '—'}
                                {isKetua && (
                                  <Badge variant="warning" className="ml-2 text-xs">👑 Ketua</Badge>
                                )}
                              </div>
                              <div className="text-sm text-gray-500">{s.email || '—'}</div>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3 text-sm text-gray-900">{getNamaKelas(s.kelas)}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{s.nis || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{JK_LABEL(s.jk)}</td>

                        <td className="px-4 py-3 text-sm">
                          {s.rfid_uid ? (
                            <Badge variant="info" className="text-xs">{(s.rfid_uid || '').toUpperCase()}</Badge>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>

                        <td className="px-4 py-3 whitespace-nowrap">
                          {(() => {
                            const meta = STATUS_META(s.status || 'active')
                            return (
                              <Badge variant={meta.variant} className="text-xs">
                                {meta.icon} {meta.label}
                              </Badge>
                            )
                          })()}
                        </td>

                        <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium space-x-1">
                          <Button variant="primary" size="sm" onClick={() => openDetail(s)}>Detail</Button>

                          {canManage && (
                            <>
                              {(s.status || 'active') === 'active' ? (
                                <Button variant="warning" size="sm" onClick={() => openNonaktifModal(s)}>Nonaktif</Button>
                              ) : (
                                <Button variant="success" size="sm" onClick={() => openAktifkanModal(s)}>Aktifkan</Button>
                              )}

                              <Button variant="danger" size="sm" onClick={() => openDeleteConfirm(s)}>Hapus</Button>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}

                  {!siswa.length && (
                    <tr>
                      <td colSpan="8" className="px-4 py-8 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <div className="text-gray-300 text-4xl mb-2">👨‍🎓</div>
                          <p className="text-gray-500 font-medium mb-1">Tidak ada data siswa</p>
                          <p className="text-gray-400 text-sm">Coba ubah filter pencarian</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* Modal Konfirmasi Hapus Siswa */}
        {canManage && deleteConfirmOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-red-100 text-red-600 rounded-lg">
                  <span className="text-xl">🗑️</span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Hapus Akun Siswa</h3>
                  <p className="text-gray-600 text-sm">Tindakan ini permanen dan tidak bisa dibatalkan</p>
                </div>
              </div>

              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 space-y-2">
                <p className="text-gray-800 text-sm">
                  Target: <strong>{siswaToDelete?.nama}</strong> ({siswaToDelete?.email})
                </p>
                <p className="text-red-700 text-xs">
                  Semua data akun siswa akan dihapus permanen dari sistem.
                </p>
              </div>

              <div className="flex justify-end space-x-3">
                <Button variant="secondary" onClick={closeDeleteConfirm} disabled={deletingSiswa}>✕ Batal</Button>
                <Button
                  variant="danger"
                  onClick={hapusAkunSiswa}
                  loading={deletingSiswa}
                >
                  🗑️ Ya, Hapus
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Nonaktifkan */}
        {canManage && nonaktifModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-orange-100 text-orange-600 rounded-lg">
                  <span className="text-xl">⏸️</span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Nonaktifkan Siswa</h3>
                  <p className="text-gray-600 text-sm">Siswa tidak akan bisa login</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Alasan Penonaktifan *
                  </label>
                  <textarea
                    value={alasanNonaktif}
                    onChange={(e) => setAlasanNonaktif(e.target.value)}
                    placeholder="Masukkan alasan menonaktifkan siswa..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white resize-none"
                    rows={3}
                  />
                </div>

                <div className="flex justify-end space-x-3">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setNonaktifModalOpen(false)
                      setAlasanNonaktif('')
                      setSiswaToNonaktif(null)
                    }}
                  >
                    ✕ Batal
                  </Button>
                  <Button
                    variant="warning"
                    onClick={nonaktifkanSiswa}
                    disabled={!alasanNonaktif.trim()}
                  >
                    ⏸️ Nonaktifkan
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal Aktifkan */}
        {canManage && aktifkanModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-green-100 text-green-600 rounded-lg">
                  <span className="text-xl">✅</span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Aktifkan Siswa</h3>
                  <p className="text-gray-600 text-sm">Siswa akan bisa login kembali</p>
                </div>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <p className="text-green-800 text-sm font-medium mb-2">
                  Apakah Anda yakin ingin mengaktifkan siswa ini?
                </p>
                <p className="text-green-700 text-sm">
                  <strong>{siswaToAktifkan?.nama}</strong> ({siswaToAktifkan?.email})
                </p>
              </div>

              <div className="flex justify-end space-x-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAktifkanModalOpen(false)
                    setSiswaToAktifkan(null)
                  }}
                >
                  ✕ Batal
                </Button>
                <Button variant="success" onClick={aktifkanSiswa}>✅ Ya, Aktifkan</Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Kenaikan Kelas */}
        {canManage && promotionModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-lg">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                  <span className="text-xl">⬆️</span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Kenaikan Kelas</h3>
                  <p className="text-gray-600 text-sm">
                    Pindahkan kelas siswa secara massal (berdasarkan kelas) atau pilih siswa manual dari sini.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex gap-2 text-sm">
                  <button
                    type="button"
                    className={`flex-1 px-3 py-2 rounded-lg border ${promotionMode === 'kelas'
                      ? 'bg-indigo-50 border-indigo-400 text-indigo-700'
                      : 'bg-gray-50 border-gray-300 text-gray-700'
                      }`}
                    onClick={() => setPromotionMode('kelas')}
                  >
                    Berdasarkan Kelas
                  </button>
                  <button
                    type="button"
                    className={`flex-1 px-3 py-2 rounded-lg border ${promotionMode === 'selected'
                      ? 'bg-indigo-50 border-indigo-400 text-indigo-700'
                      : 'bg-gray-50 border-gray-300 text-gray-700'
                      }`}
                    onClick={() => setPromotionMode('selected')}
                  >
                    Pilih Siswa Manual ({promotionSelectedIds.length})
                  </button>
                </div>

                {promotionMode === 'kelas' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Select
                      label="Kelas Asal"
                      value={promotionFromKelas}
                      onChange={e => setPromotionFromKelas(e.target.value)}
                      options={[
                        { value: '', label: 'Pilih kelas asal' },
                        ...kelasOptions.map(k => ({ value: k.value, label: k.label }))
                      ]}
                    />
                    <Select
                      label="Kelas Tujuan"
                      value={promotionToKelas}
                      onChange={e => setPromotionToKelas(e.target.value)}
                      options={[
                        { value: '', label: 'Pilih kelas tujuan' },
                        ...kelasOptions.map(k => ({ value: k.value, label: k.label })),
                        { value: PROMO_ALUMNI, label: `🎓 Alumni (Lulus, tahun ${promotionAlumniYear || new Date().getFullYear()})` },
                        { value: PROMO_MUTASI, label: '📤 Mutasi / Pindah Sekolah' }
                      ]}
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-700">
                      Pilih siswa yang akan dipindahkan ke kelas tujuan. Bisa filter berdasarkan tingkatan dan kelas asal.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Select
                        label="Filter Tingkatan"
                        value={promotionFilterGrade}
                        onChange={e => {
                          setPromotionFilterGrade(e.target.value)
                          setPromotionFilterKelas('')
                        }}
                        options={[
                          { value: '', label: 'Semua tingkatan' },
                          ...gradeLabels.map(g => ({ value: g, label: g }))
                        ]}
                      />
                      <Select
                        label="Filter Kelas Asal"
                        value={promotionFilterKelas}
                        onChange={e => setPromotionFilterKelas(e.target.value)}
                        options={[
                          { value: '', label: 'Semua kelas' },
                          ...kelasOptions
                            .filter(k => !promotionFilterGrade || getGradeLabel(k.value) === promotionFilterGrade)
                            .map(k => ({ value: k.value, label: k.label }))
                        ]}
                      />
                    </div>

                    <div className="border rounded-lg max-h-56 overflow-y-auto">
                      <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                        <p className="text-xs text-gray-600">
                          Siswa terlihat: <span className="font-semibold">{promotionCandidateSiswa.length}</span>
                          {' '}• Dipilih: <span className="font-semibold">{promotionSelectedIds.length}</span>
                        </p>
                        <button
                          type="button"
                          className="text-xs text-blue-600 hover:underline disabled:text-gray-400"
                          onClick={togglePromotionSelectAllVisible}
                          disabled={!promotionCandidateSiswa.length}
                        >
                          {promotionCandidateSiswa.length > 0 &&
                            promotionCandidateSiswa.every(s => promotionSelectedIds.includes(s.id))
                            ? 'Hapus pilih semua'
                            : 'Pilih semua yang terlihat'}
                        </button>
                      </div>

                      {promotionCandidateSiswa.length ? (
                        <ul className="divide-y divide-gray-100">
                          {promotionCandidateSiswa.map(s => (
                            <li key={s.id} className="px-3 py-2 flex items-center gap-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                                checked={promotionSelectedIds.includes(s.id)}
                                onChange={() => togglePromotionSelect(s.id)}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-900 truncate">
                                  {s.nama || s.email || 'Tanpa nama'}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {getNamaKelas(s.kelas)} • {s.email}
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="px-3 py-4 text-center text-sm text-gray-500">
                          Tidak ada siswa yang cocok dengan filter.
                        </div>
                      )}
                    </div>

                    <Select
                      label="Kelas Tujuan"
                      value={promotionToKelas}
                      onChange={e => setPromotionToKelas(e.target.value)}
                      options={[
                        { value: '', label: 'Pilih kelas tujuan' },
                        ...kelasOptions.map(k => ({ value: k.value, label: k.label })),
                        { value: PROMO_ALUMNI, label: `🎓 Alumni (Lulus, tahun ${promotionAlumniYear || new Date().getFullYear()})` },
                        { value: PROMO_MUTASI, label: '📤 Mutasi / Pindah Sekolah' }
                      ]}
                    />

                    {!promotionSelectedIds.length && (
                      <p className="text-xs text-red-500">
                        Pilih minimal satu siswa untuk dipindahkan.
                      </p>
                    )}
                  </div>
                )}

                {(promotionToKelas === PROMO_ALUMNI || promotionToKelas === PROMO_MUTASI) && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-3">
                    <p className="text-sm text-yellow-900">
                      Mode khusus dipilih: <strong>{promotionToKelas === PROMO_ALUMNI ? 'Alumni (Lulus)' : 'Mutasi (Pindah Sekolah)'}</strong>.
                      Tidak ada data riwayat yang dihapus.
                    </p>

                    {promotionToKelas === PROMO_ALUMNI && (
                      <Input
                        label="Tahun Lulus"
                        type="number"
                        min="2000"
                        max="2100"
                        value={promotionAlumniYear}
                        onChange={(e) => setPromotionAlumniYear(e.target.value)}
                        placeholder="2025"
                      />
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Alasan / Catatan *</label>
                      <textarea
                        value={promotionExitReason}
                        onChange={(e) => setPromotionExitReason(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white resize-none"
                        rows={3}
                        placeholder={promotionToKelas === PROMO_ALUMNI ? 'Contoh: Lulus sesuai kelulusan sekolah.' : 'Contoh: Pindah sekolah (mutasi orang tua).'}
                      />
                      {!promotionExitReason.trim() && (
                        <p className="text-xs text-red-500 mt-1">Alasan wajib diisi untuk keamanan audit.</p>
                      )}
                    </div>

                    <p className="text-xs text-yellow-800">
                      Sistem akan mengosongkan kelas & RFID agar tidak muncul di roster kelas aktif.
                    </p>
                  </div>
                )}

                <p className="text-xs text-gray-500">
                  Catatan: Kenaikan kelas boleh lintas tingkatan (misal X → XI), sistem akan memberi peringatan saat konfirmasi.
                </p>

                <div className="flex justify-end space-x-3 pt-2">
                  <Button variant="secondary" onClick={closePromotionModal} disabled={promotionLoading}>✕ Batal</Button>
                  <Button
                    onClick={handlePromotion}
                    loading={promotionLoading}
                    disabled={
                      promotionLoading ||
                      !promotionToKelas ||
                      (promotionMode === 'kelas' && !promotionFromKelas) ||
                      ((promotionToKelas === PROMO_ALUMNI || promotionToKelas === PROMO_MUTASI) && !promotionExitReason.trim())
                    }
                  >
                    ⬆️ Jalankan
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal Detail Siswa */}
        {detailOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b bg-gray-50 flex items-start justify-between">
                <div className="flex items-center space-x-4">
                  <div className="flex-shrink-0 h-12 w-12">
                    <ProfileAvatar
                      src={detailUser?.photo_path || detailUser?.photo_url}
                      name={detailUser?.nama}
                      size={48}
                      className="border-gray-200"
                      fallbackClassName="rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-base font-semibold text-blue-600"
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {detailUser?.nama || detailUser?.email}
                      </h3>
                      {!canManage && (
                        <Badge variant="info" className="text-xs">
                          Wali Kelas • Read-only
                        </Badge>
                      )}
                      {isKetuaKelas(detailUser?.id) && (
                        <Badge variant="warning" className="text-xs">
                          👑 Ketua {getKelasKetua(detailUser?.id)}
                        </Badge>
                      )}
                      {detailUser?.status && detailUser.status !== 'active' && (
                        <Badge variant={STATUS_META(detailUser.status).variant} className="text-xs">
                          {STATUS_META(detailUser.status).icon} {STATUS_META(detailUser.status).label}
                        </Badge>
                      )}
                    </div>
                    <p className="text-gray-600 text-sm mt-1">
                      {detailUser?.email || '—'} • NIS: {detailUser?.nis || '—'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  {canManage && (
                    <>
                      {detailUser?.status === 'active' ? (
                        <Button variant="warning" size="sm" onClick={() => openNonaktifModal(detailUser)}>
                          ⏸️ Nonaktif
                        </Button>
                      ) : (
                        <Button variant="success" size="sm" onClick={() => openAktifkanModal(detailUser)}>
                          ✅ Aktifkan
                        </Button>
                      )}
                      <Button variant="danger" size="sm" onClick={() => openDeleteConfirm(detailUser)}>
                        🗑️ Hapus
                      </Button>
                    </>
                  )}
                  <button
                    className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                    onClick={closeDetailModal}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6 overflow-y-auto flex-1">
                {detailLoading ? (
                  <div className="space-y-4">
                    <div className="animate-pulse h-16 bg-gray-200 rounded-lg" />
                    <div className="animate-pulse h-24 bg-gray-200 rounded-lg" />
                    <div className="animate-pulse h-20 bg-gray-200 rounded-lg" />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Kelas */}
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <h4 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                          <span>🏫</span>
                          Kelas & Status
                        </h4>
                        {!canManage && (
                          <div className="mb-3 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                            Mode baca saja untuk wali kelas. Perubahan data siswa dinonaktifkan.
                          </div>
                        )}
                        <div className="space-y-3">
                          {canManage ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <Select
                                label="Tingkatan"
                                value={moveGrade}
                                onChange={e => { setMoveGrade(e.target.value); setMoveKelas('') }}
                                disabled={!canManage}
                                options={[
                                  { value: '', label: 'Pilih tingkatan' },
                                  ...gradeLabels.map(g => ({ value: g, label: g }))
                                ]}
                              />
                              <Select
                                label="Kelas"
                                value={moveKelas}
                                onChange={e => setMoveKelas(e.target.value)}
                                disabled={!canManage}
                                options={(() => {
                                  const baseGrade = getGradeLabel(detailUser?.kelas || '') || moveGrade
                                  const options = kelasByGrade(baseGrade)

                                  if (!baseGrade) return [{ value: '', label: 'Pilih tingkatan dulu' }]
                                  if (options.length === 0) return [{ value: '', label: 'Tidak ada kelas pada tingkatan ini' }]

                                  return [
                                    { value: '', label: 'Pilih kelas' },
                                    ...options.map(k => ({ value: k.id, label: getKelasDisplayName(k) }))
                                  ]
                                })()}
                              />
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                                <p className="text-xs text-gray-500 mb-1">Tingkatan</p>
                                <p className="text-sm font-semibold text-gray-900">
                                  {getGradeLabel(detailUser?.kelas || '') || '—'}
                                </p>
                              </div>
                              <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                                <p className="text-xs text-gray-500 mb-1">Kelas</p>
                                <p className="text-sm font-semibold text-gray-900">
                                  {getNamaKelas(detailUser?.kelas) || '—'}
                                </p>
                              </div>
                            </div>
                          )}

                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t">
                            <div className="text-sm">
                              <span className="text-gray-600">Status: </span>
                              <span className={detailUser?.status && detailUser.status !== 'active' ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                                {STATUS_META(detailUser?.status || 'active').label}
                              </span>
                            </div>
                            {canManage && (
                              <div className="flex gap-2">
                                <Button onClick={simpanPindahKelas} disabled={!moveKelas || moveKelas === detailUser?.kelas} size="sm">
                                  💾 Simpan
                                </Button>
                                <Button variant="secondary" onClick={kosongkanKelas} size="sm">
                                  🗑️ Kosongkan
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* RFID */}
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <h4 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                          <span>💳</span>
                          Kartu RFID
                        </h4>

                        <div className="space-y-3">
                          <div>
                            <Input
                              label="UID RFID"
                              value={rfidInput}
                              onChange={e => setRfidInput(e.target.value.toUpperCase())}
                              placeholder="Tap kartu atau isi manual"
                              disabled={!canManageRfid}
                            />
                            {detailUser?.rfid_uid && (
                              <p className="text-xs text-gray-500 mt-1">
                                UID tersimpan:{' '}
                                <span className="font-mono font-medium">
                                  {(detailUser.rfid_uid || '').toUpperCase()}
                                </span>
                              </p>
                            )}
                          </div>

                          {canManageRfid && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <Button
                                variant={rfidEnrolling ? 'warning' : 'primary'}
                                size="sm"
                                onClick={toggleRfidListen}
                              >
                                {rfidEnrolling ? '⏹️ Stop' : '🎫 Scan'}
                              </Button>
                              <Button variant="success" size="sm" onClick={saveRfid} disabled={!rfidInput}>
                                💾 Simpan
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={clearRfid}
                                disabled={!detailUser?.rfid_uid && !rfidInput}
                              >
                                🗑️ Hapus
                              </Button>
                            </div>
                          )}

                          {rfidLastScan && (
                            <div className="text-xs text-gray-500">
                              Terakhir scan: <span className="font-mono">{(rfidLastScan.card_uid || '').toUpperCase()}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Phone */}
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                          <span>📱</span>
                          Informasi Kontak
                        </h4>
                        {canManage && !editingPhone && (
                          <Button variant="primary" size="sm" onClick={handleEditPhone}>
                            ✏️ Edit
                          </Button>
                        )}
                      </div>

                      {editingPhone ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Nomor HP Siswa
                              </label>
                              <input
                                type="tel"
                                name="no_hp_siswa"
                                value={editPhoneForm.no_hp_siswa}
                                onChange={handlePhoneChange}
                                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 ${phoneErrors.no_hp_siswa ? 'border-red-300 bg-red-50' : 'border-gray-300'
                                  }`}
                                placeholder="081234567890 / 6281234567890 / 81234567890"
                                maxLength={18}
                              />
                              {phoneErrors.no_hp_siswa && (
                                <p className="mt-1 text-xs text-red-600">{phoneErrors.no_hp_siswa}</p>
                              )}
                              <p className="mt-1 text-xs text-gray-500">
                                Sistem menyimpan otomatis dalam format 0xxxxxxxx.
                              </p>
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Nomor HP Orang Tua/Wali
                              </label>
                              <input
                                type="tel"
                                name="no_hp_wali"
                                value={editPhoneForm.no_hp_wali}
                                onChange={handlePhoneChange}
                                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 ${phoneErrors.no_hp_wali ? 'border-red-300 bg-red-50' : 'border-gray-300'
                                  }`}
                                placeholder="081234567890 / 6281234567890 / 81234567890"
                                maxLength={18}
                              />
                              {phoneErrors.no_hp_wali && (
                                <p className="mt-1 text-xs text-red-600">{phoneErrors.no_hp_wali}</p>
                              )}
                              <p className="mt-1 text-xs text-gray-500">
                                Sistem menyimpan otomatis dalam format 0xxxxxxxx.
                              </p>
                            </div>
                          </div>

                          <div className="flex justify-end space-x-3">
                            <Button variant="secondary" size="sm" onClick={handleCancelEditPhone}>
                              ✕ Batal
                            </Button>
                            <Button variant="success" size="sm" onClick={handleSavePhone}>
                              💾 Simpan
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="p-3 bg-gray-50 rounded-lg">
                            <p className="text-sm font-medium text-gray-700 mb-1">Nomor HP Siswa</p>
                            <p className="text-lg font-semibold text-gray-900">
                              {formatPhoneDisplay(detailUser?.no_hp_siswa)}
                            </p>
                            {detailUser?.no_hp_siswa && (
                              <p className="text-xs text-gray-500 mt-1">
                                Tersimpan: {detailUser.no_hp_siswa}
                              </p>
                            )}
                          </div>

                          <div className="p-3 bg-gray-50 rounded-lg">
                            <p className="text-sm font-medium text-gray-700 mb-1">Nomor HP Orang Tua/Wali</p>
                            <p className="text-lg font-semibold text-gray-900">
                              {formatPhoneDisplay(detailUser?.no_hp_wali)}
                            </p>
                            {detailUser?.no_hp_wali && (
                              <p className="text-xs text-gray-500 mt-1">
                                Tersimpan: {detailUser.no_hp_wali}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Organisasi & OSIS */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <h4 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                          <span>👥</span>
                          Organisasi ({orgMember.length})
                        </h4>
                        <div className="space-y-2 max-h-40 overflow-y-auto">
                          {orgMember.map(row => (
                            <div key={row.orgId} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                              <div>
                                <p className="text-sm font-medium text-gray-900">{row.orgNama}</p>
                                <p className="text-xs text-gray-500">{row.jabatan} • {row.bagian || '-'}</p>
                              </div>
                              {canManage && (
                                <Button variant="danger" size="sm" onClick={() => hapusOrg(row.orgId)}>🗑️</Button>
                              )}
                            </div>
                          ))}
                          {!orgMember.length && (
                            <p className="text-gray-500 text-sm text-center py-4">Belum terdaftar di organisasi</p>
                          )}
                        </div>
                      </div>

                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <h4 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                          <span>🌟</span>
                          OSIS
                        </h4>
                        {osisRow ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <p className="text-sm font-medium text-gray-700">Status</p>
                                <Badge variant={osisRow.status === 'aktif' ? 'success' : 'danger'} className="text-xs">
                                  {osisRow.status}
                                </Badge>
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-700">Jabatan</p>
                                <p className="text-sm text-gray-900">{osisRow.jabatan}</p>
                              </div>
                            </div>
                            {osisRow.bagian && (
                              <div>
                                <p className="text-sm font-medium text-gray-700">Bagian</p>
                                <p className="text-sm text-gray-900">{osisRow.bagian}</p>
                              </div>
                            )}
                            {canManage && (
                              <div className="flex justify-end">
                                <Button variant="danger" size="sm" onClick={hapusOsis}>🗑️ Hapus</Button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-gray-500 text-sm text-center py-4">Belum terdaftar di OSIS</p>
                        )}
                      </div>
                    </div>

                    {/* Informasi Tambahan */}
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <h4 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <span>📋</span>
                        Informasi Tambahan
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                          <p className="text-sm font-medium text-gray-700">Jenis Kelamin</p>
                          <p className="text-sm text-gray-900">{JK_LABEL(detailUser?.jk)}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-700">Usia</p>
                          <p className="text-sm text-gray-900">{detailUser?.usia ? `${detailUser.usia} tahun` : '—'}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-700">Tanggal Lahir</p>
                          <p className="text-sm text-gray-900">{formatDate(detailUser?.tanggal_lahir)}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-700">Agama</p>
                          <p className="text-sm text-gray-900">{detailUser?.agama || '—'}</p>
                        </div>
                        <div className="md:col-span-2 lg:col-span-1">
                          <p className="text-sm font-medium text-gray-700">Alamat</p>
                          <p className="text-sm text-gray-900">{detailUser?.alamat || '—'}</p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


