import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useUIStore } from '../../store/useUIStore'

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
          <input
            type="password"
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

/* ===== Alumni year helper =====
   Default: parse dari alasan_nonaktif "Lulus tahun 20xx"
   (Jika ada kolom alumni_year di DB, akan ikut kebaca juga)
*/
function getAlumniYear(row) {
  if (!row) return ''
  if (row.alumni_year) return String(row.alumni_year)
  const txt = String(row.alasan_nonaktif || '')
  const m = txt.match(/lulus\s+tahun\s+(\d{4})/i)
  return m ? String(m[1]) : ''
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

/* ===========================
   UI Components
=========================== */
function Card({ children, className = '' }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden ${className}`}>
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

function Input({ label, error, className = '', ...props }) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <input
        className={`block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white ${className}`}
        {...props}
      />
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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
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
  const [loadingInit, setLoadingInit] = useState(true)

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

  // Search fields
  const [qNama, setQNama] = useState('')
  const [qNIK, setQNIK] = useState('')
  const [qKelas, setQKelas] = useState('')
  const [qHasRfid, setQHasRfid] = useState('')
  const [qStatus, setQStatus] = useState('')
  const [qHideExit, setQHideExit] = useState(true) // default: alumni/mutasi disembunyikan dari roster
  const [qAlumniYear, setQAlumniYear] = useState('') // muncul saat filter status = alumni
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
    nik: '',
    jk: '',
    password: '',
    confirmPassword: ''
  })
  const [formErrors, setFormErrors] = useState({})
  const [showAddForm, setShowAddForm] = useState(false)
  const [addingSiswa, setAddingSiswa] = useState(false)

  // Soft delete / keluar sekolah
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [siswaToDelete, setSiswaToDelete] = useState(null)
  const [deletingSiswa, setDeletingSiswa] = useState(false)
  const [keluarMode, setKeluarMode] = useState('mutasi')
  const [keluarYear, setKeluarYear] = useState(String(new Date().getFullYear()))
  const [keluarReason, setKeluarReason] = useState('')

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
    loadAllData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadAllData = async () => {
    try {
      setLoadingInit(true)
      await Promise.all([
        loadSiswaRaw(),
        loadKelasList(),
        loadStrukturKelas()
      ])
    } catch (error) {
      console.error('Error loading data:', error)
      pushToast('error', 'Gagal memuat data')
    } finally {
      setLoadingInit(false)
    }
  }

  const loadSiswaRaw = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'siswa')
      .order('kelas', { ascending: true })
      .order('nama', { ascending: true })

    if (error) throw error
    setSiswaRaw(data || [])
    setSiswa(data || [])
  }

  const loadKelasList = async () => {
    const { data, error } = await supabase
      .from('kelas')
      .select('*')
      .order('grade', { ascending: true })
      .order('suffix', { ascending: true })

    if (error) throw error
    setKelasList(data || [])
  }

  const loadStrukturKelas = async () => {
    const { data, error } = await supabase
      .from('kelas_struktur')
      .select('*')

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

  /* ===== Alumni year options (untuk filter alumni) ===== */
  const alumniYearOptions = useMemo(() => {
    const ys = new Set()
    for (const s of siswaRaw) {
      const st = String(s.status || 'active').toLowerCase()
      if (st !== 'alumni') continue
      const y = getAlumniYear(s)
      if (y) ys.add(String(y))
    }
    // urutkan terbaru dulu
    return [...ys].sort((a, b) => Number(b) - Number(a))
  }, [siswaRaw])

  /* ===== Filter (debounced) ===== */
  const applyFilterNow = () => {
    const namaNeedle = qNama.trim().toLowerCase()
    const nikNeedle = qNIK.trim().toLowerCase()
    const kelasNeedle = qKelas
    const hasRfidNeedle = qHasRfid
    const statusNeedle = qStatus
    const hideExit = qHideExit
    const alumniYearNeedle = qAlumniYear

    const res = siswaRaw.filter(s => {
      const okNama = namaNeedle
        ? (String(s.nama || '').toLowerCase().includes(namaNeedle) ||
          String(s.email || '').toLowerCase().includes(namaNeedle))
        : true

      const okNik = nikNeedle
        ? (String(s.nik || '').toLowerCase().includes(nikNeedle))
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

      const currentStatus = String(s.status || 'active').toLowerCase()

      // Jika statusNeedle tidak dipilih dan hideExit = true,
      // maka alumni & mutasi tidak ditampilkan di roster.
      const okExit = statusNeedle
        ? true
        : (hideExit ? !['alumni', 'mutasi'].includes(currentStatus) : true)

      const okStatus = statusNeedle === ''
        ? true
        : currentStatus === String(statusNeedle).toLowerCase()

      // Filter tahun lulus hanya relevan saat status = alumni
      const okAlumniYear = (String(statusNeedle).toLowerCase() === 'alumni' && alumniYearNeedle)
        ? String(getAlumniYear(s) || '') === String(alumniYearNeedle)
        : true

      return okNama && okNik && okKls && okRfid && okStatus && okExit && okAlumniYear
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
    setQNIK('')
    setQKelas('')
    setQHasRfid('')
    setQStatus('')
    setQAlumniYear('')
    setQHideExit(true)
    setSiswa(siswaRaw)
  }

  // jika status bukan alumni, reset filter tahun alumni (biar tidak nyangkut)
  useEffect(() => {
    if (String(qStatus || '').toLowerCase() !== 'alumni') {
      if (qAlumniYear) setQAlumniYear('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qStatus])

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
  }, [qNama, qNIK, qKelas, qHasRfid, qStatus, qHideExit, qAlumniYear, siswaRaw])

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

      // Build confirm message
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

      // reset ketua kelas untuk semua kelas asal yg terdampak + kelas tujuan
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
  const openDetail = (u) => {
    openPasswordModal(
      'Konfirmasi Lihat Detail Siswa',
      async () => {
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

        setDetailLoading(true)
        setDetailOpen(true)

        try {
          const { data: orgData, error: orgError } = await supabase
            .from('organisasi')
            .select('*')

          if (orgError) throw orgError

          const all = orgData?.map(o => ({ id: o.id, nama: o.nama || o.id })) || []
          setOrgAll(all)

          const { data: orgAnggotaData, error: orgAnggotaError } = await supabase
            .from('organisasi_anggota')
            .select('*')
            .eq('siswa_id', u.id)

          if (orgAnggotaError) throw orgAnggotaError

          const mine = orgAnggotaData?.map(a => ({
            orgId: a.organisasi_id,
            orgNama: all.find(o => o.id === a.organisasi_id)?.nama || a.organisasi_id,
            status: a.status || 'aktif',
            bagian: a.bagian || '',
            jabatan: a.jabatan || 'Anggota'
          })) || []

          setOrgMember(mine)

          const { data: osisData, error: osisError } = await supabase
            .from('osis_anggota')
            .select('*')
            .eq('siswa_id', u.id)
            .single()

          if (osisError && osisError.code !== 'PGRST116') throw osisError

          const row = osisData ? {
            status: osisData.status || 'aktif',
            bagian: osisData.bagian || '',
            jabatan: osisData.jabatan || 'Anggota'
          } : null
          setOsisRow(row)
        } catch (error) {
          console.error('Error loading detail:', error)
          pushToast('error', 'Gagal memuat detail siswa')
        } finally {
          setDetailLoading(false)
        }
      }
    )
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

  /* ===== Soft Delete / Keluar Sekolah ===== */
  function openDeleteConfirm(siswa) {
    openPasswordModal(
      'Konfirmasi Keluar Sekolah',
      () => {
        setSiswaToDelete(siswa)
        const g = getGradeLabel(siswa?.kelas || '')
        setKeluarMode(g === 'XII' ? 'alumni' : 'mutasi')
        setKeluarYear(String(new Date().getFullYear()))
        setKeluarReason('')
        setDeleteConfirmOpen(true)
      }
    )
  }

  function closeDeleteConfirm() {
    setDeleteConfirmOpen(false)
    setSiswaToDelete(null)
    setKeluarReason('')
    setKeluarMode('mutasi')
    setKeluarYear(String(new Date().getFullYear()))
  }

  const hapusAkunSiswa = () => {
    if (!siswaToDelete) return
    if (!keluarReason.trim()) {
      pushToast('error', 'Harap masukkan alasan')
      return
    }

    openPasswordModal(
      'Konfirmasi Akhir Keluar Sekolah',
      async () => {
        try {
          setDeletingSiswa(true)

          const now = new Date().toISOString()
          const lastKelasName = getNamaKelas(siswaToDelete.kelas)
          const lastKelasRaw = siswaToDelete.kelas || ''
          const lastInfo = lastKelasName || lastKelasRaw || '-'

          let alasan = keluarReason.trim()
          const status = keluarMode

          if (status === 'alumni') {
            const y = parseInt(keluarYear, 10) || new Date().getFullYear()
            alasan = `Lulus tahun ${y}. Kelas terakhir: ${lastInfo}. ${alasan}`
          } else if (status === 'mutasi') {
            alasan = `Mutasi/pindah sekolah. Kelas terakhir: ${lastInfo}. ${alasan}`
          } else {
            alasan = `Nonaktif permanen. Kelas terakhir: ${lastInfo}. ${alasan}`
          }

          const payload = {
            status,
            alasan_nonaktif: alasan,
            disabled_at: now,
            rfid_uid: null,
            kelas: ''
          }

          const { error } = await supabase
            .from('profiles')
            .update(payload)
            .eq('id', siswaToDelete.id)

          if (error) throw error

          // reset ketua kelas jika perlu
          try {
            await supabase
              .from('kelas_struktur')
              .update({ ketua_siswa_id: null, ketua_siswa_nama: null })
              .eq('ketua_siswa_id', siswaToDelete.id)
          } catch {}

          pushToast('success', `Berhasil: ${status === 'alumni' ? 'dijadikan alumni' : status === 'mutasi' ? 'dimutasi' : 'dinonaktifkan'} (riwayat aman)`)

          closeDeleteConfirm()
          if (detailOpen) closeDetailModal()
          await loadAllData()
        } catch (error) {
          console.error('Error soft-delete/keluar sekolah:', error)
          pushToast('error', 'Gagal memproses: ' + (error.message || 'Unknown error'))
        } finally {
          setDeletingSiswa(false)
        }
      }
    )
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
    if (form.nik && !/^\d+$/.test(form.nik)) errors.nik = 'NIK harus berupa angka'

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
      nik: '',
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
        nik: form.nik || '',
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
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Password Modal */}
        <PasswordModal
          isOpen={passwordModal.isOpen}
          onClose={closePasswordModal}
          onConfirm={handlePasswordConfirm}
          title={passwordModal.title}
          loading={passwordModal.loading}
        />

        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
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
              </div>
            </div>

            <div className="mt-4 lg:mt-0 flex flex-col sm:flex-row gap-2">
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
        {showAddForm && (
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
                  label="NIK"
                  name="nik"
                  value={form.nik}
                  onChange={handleChange}
                  placeholder="Nomor Induk Siswa"
                  error={formErrors.nik}
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
                label="NIK"
                placeholder="Cari NIK"
                value={qNIK}
                onChange={e => setQNIK(e.target.value)}
              />
              <Select
                label="Kelas"
                value={qKelas}
                onChange={e => setQKelas(e.target.value)}
                options={[
                  { value: '', label: 'Semua Kelas' },
                  ...kelasOptions.map(k => ({ value: k.value, label: k.label }))
                ]}
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

            {/* Tambahan: tampilkan/sembunyikan alumni & mutasi + filter tahun alumni */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
              <div className="flex items-center gap-2">
                <input
                  id="hide-exit"
                  type="checkbox"
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                  checked={qHideExit}
                  onChange={(e) => setQHideExit(e.target.checked)}
                  disabled={String(qStatus || '').toLowerCase() === 'alumni' || String(qStatus || '').toLowerCase() === 'mutasi'}
                  title="Jika Anda memilih status Alumni/Mutasi, checkbox ini tidak berlaku."
                />
                <label htmlFor="hide-exit" className="text-sm text-gray-700 select-none">
                  Sembunyikan <span className="font-medium">Alumni & Mutasi</span> dari daftar (roster)
                </label>
              </div>

              {String(qStatus || '').toLowerCase() === 'alumni' && (
                <Select
                  label="Tahun Lulus"
                  value={qAlumniYear}
                  onChange={e => setQAlumniYear(e.target.value)}
                  options={[
                    { value: '', label: 'Semua Tahun' },
                    ...alumniYearOptions.map(y => ({ value: y, label: y }))
                  ]}
                />
              )}

              <div className="flex justify-end space-x-3 md:col-span-2 lg:col-span-1">
                <Button onClick={applyFilter} loading={isSearching}>Cari</Button>
                <Button variant="secondary" onClick={resetFilter}>🔄 Reset</Button>
              </div>
            </div>

            <p className="text-xs text-gray-500 mt-3">
              Default: daftar menyembunyikan Alumni & Mutasi agar tampilan lebih fokus ke roster aktif. Pilih status <b>Alumni</b> untuk memunculkan filter tahun lulus.
            </p>
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">NIK</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">JK</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">RFID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Aksi</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {siswa.map((s, index) => {
                    const foto = s.photo_url || s.foto_url || s.foto || ''
                    const isKetua = isKetuaKelas(s.id)

                    return (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-center">{index + 1}</td>

                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10">
                              {foto ? (
                                <img
                                  src={foto}
                                  alt={s.nama || 'foto'}
                                  className="h-10 w-10 rounded-full object-cover border border-gray-200"
                                />
                              ) : (
                                <div className="h-10 w-10 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-sm font-medium text-blue-600">
                                  {initials(s.nama)}
                                </div>
                              )}
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
                        <td className="px-4 py-3 text-sm text-gray-900">{s.nik || '—'}</td>
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
                                {String(s.status || '').toLowerCase() === 'alumni' && getAlumniYear(s) ? (
                                  <span className="ml-1 opacity-80">({getAlumniYear(s)})</span>
                                ) : null}
                              </Badge>
                            )
                          })()}
                        </td>

                        <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium space-x-1">
                          <Button variant="primary" size="sm" onClick={() => openDetail(s)}>Detail</Button>

                          {(s.status || 'active') === 'active' ? (
                            <Button variant="warning" size="sm" onClick={() => openNonaktifModal(s)}>Nonaktif</Button>
                          ) : (
                            <Button variant="success" size="sm" onClick={() => openAktifkanModal(s)}>Aktifkan</Button>
                          )}

                          <Button variant="danger" size="sm" onClick={() => openDeleteConfirm(s)}>Keluar</Button>
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

        {/* Modal Konfirmasi Keluar Sekolah */}
        {deleteConfirmOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-red-100 text-red-600 rounded-lg">
                  <span className="text-xl">🚪</span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Keluarkan dari Sekolah</h3>
                  <p className="text-gray-600 text-sm">Tanpa menghapus riwayat absensi / tugas</p>
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 space-y-3">
                <p className="text-gray-800 text-sm">
                  Target: <strong>{siswaToDelete?.nama}</strong> ({siswaToDelete?.email})
                </p>

                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Mode</label>
                    <select
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white"
                      value={keluarMode}
                      onChange={(e) => setKeluarMode(e.target.value)}
                      disabled={deletingSiswa}
                    >
                      <option value="mutasi">📤 Mutasi / Pindah Sekolah</option>
                      <option value="alumni">🎓 Alumni / Lulus</option>
                      <option value="nonaktif">⏸️ Nonaktif Permanen</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Catatan: semua mode di atas akan mematikan akses login.
                    </p>
                  </div>

                  {keluarMode === 'alumni' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Tahun Lulus</label>
                      <input
                        type="number"
                        min="2000"
                        max="2100"
                        value={keluarYear}
                        onChange={(e) => setKeluarYear(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                        placeholder="2025"
                        disabled={deletingSiswa}
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Alasan *</label>
                    <textarea
                      value={keluarReason}
                      onChange={(e) => setKeluarReason(e.target.value)}
                      placeholder={
                        keluarMode === 'alumni'
                          ? 'Contoh: Lulus sesuai kelulusan sekolah.'
                          : 'Contoh: Pindah sekolah / mutasi orang tua.'
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white resize-none"
                      rows={3}
                      disabled={deletingSiswa}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Sistem akan: mengosongkan kelas & RFID agar tidak muncul di daftar aktif, tapi riwayat tetap aman.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3">
                <Button variant="secondary" onClick={closeDeleteConfirm} disabled={deletingSiswa}>✕ Batal</Button>
                <Button
                  variant="danger"
                  onClick={hapusAkunSiswa}
                  loading={deletingSiswa}
                  disabled={!keluarReason.trim()}
                >
                  🚪 Proses
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Nonaktifkan */}
        {nonaktifModalOpen && (
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
        {aktifkanModalOpen && (
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

        {/* Modal Kenaikan Kelas (dengan scroll modal) */}
        {promotionModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
              <div className="p-6 border-b bg-gray-50">
                <div className="flex items-center gap-3">
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
              </div>

              <div className="p-6 overflow-y-auto space-y-4">
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
                    {detailUser?.photo_url ? (
                      <img
                        src={detailUser.photo_url}
                        alt={detailUser.nama || 'foto'}
                        className="h-12 w-12 rounded-full object-cover border border-gray-200"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-base font-semibold text-blue-600">
                        {initials(detailUser?.nama)}
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {detailUser?.nama || detailUser?.email}
                      </h3>
                      {isKetuaKelas(detailUser?.id) && (
                        <Badge variant="warning" className="text-xs">
                          👑 Ketua {getKelasKetua(detailUser?.id)}
                        </Badge>
                      )}
                      {detailUser?.status && detailUser.status !== 'active' && (
                        <Badge variant={STATUS_META(detailUser.status).variant} className="text-xs">
                          {STATUS_META(detailUser.status).icon} {STATUS_META(detailUser.status).label}
                          {String(detailUser.status).toLowerCase() === 'alumni' && getAlumniYear(detailUser) ? (
                            <span className="ml-1 opacity-80">({getAlumniYear(detailUser)})</span>
                          ) : null}
                        </Badge>
                      )}
                    </div>
                    <p className="text-gray-600 text-sm mt-1">
                      {detailUser?.email || '—'} • NIK: {detailUser?.nik || '—'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
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
                    🚪 Keluar
                  </Button>
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
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Select
                              label="Tingkatan"
                              value={moveGrade}
                              onChange={e => { setMoveGrade(e.target.value); setMoveKelas('') }}
                              options={[
                                { value: '', label: 'Pilih tingkatan' },
                                ...gradeLabels.map(g => ({ value: g, label: g }))
                              ]}
                            />
                            <Select
                              label="Kelas"
                              value={moveKelas}
                              onChange={e => setMoveKelas(e.target.value)}
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

                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t">
                            <div className="text-sm">
                              <span className="text-gray-600">Status: </span>
                              <span className={detailUser?.status && detailUser.status !== 'active' ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                                {STATUS_META(detailUser?.status || 'active').label}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <Button onClick={simpanPindahKelas} disabled={!moveKelas || moveKelas === detailUser?.kelas} size="sm">
                                💾 Simpan
                              </Button>
                              <Button variant="secondary" onClick={kosongkanKelas} size="sm">
                                🗑️ Kosongkan
                              </Button>
                            </div>
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
                        {!editingPhone && (
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
                              <Button variant="danger" size="sm" onClick={() => hapusOrg(row.orgId)}>🗑️</Button>
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
                            <div className="flex justify-end">
                              <Button variant="danger" size="sm" onClick={hapusOsis}>🗑️ Hapus</Button>
                            </div>
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

out_path = Path("/mnt/data/ASiswa.jsx")
out_path.write_text(content, encoding="utf-8")
str(out_path), out_path.stat().st_size
