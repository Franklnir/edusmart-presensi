import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useUIStore } from '../../store/useUIStore'
import PasswordInput from '../../components/PasswordInput'
import { loadExcelJsBrowser } from '../../utils/excelBrowser'
import {
  getCurrentAcademicPeriod,
  generateAcademicYearOptions,
  getNextAcademicPeriod,
  inferCohortYear,
  normalizeAcademicYear,
  normalizeSemester,
  resolveAcademicPeriod
} from '../../utils/academicPeriod'

/* ===== Password Modal Component (Akses Halaman) ===== */
function PasswordModal({ isOpen, onClose, onConfirm, title = "Konfirmasi Password", loading = false }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!password.trim()) {
      setError('Password tidak boleh kosong')
      return
    }
    
    setError('')
    onConfirm(password)
  }

  const handleClose = () => {
    setPassword('')
    setError('')
    onClose()
  }

  // Close on ESC key
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center mb-4">
          <div className="p-3 bg-blue-100 rounded-xl mr-3">
            <span className="text-2xl">🔒</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            <p className="text-gray-600 text-sm">
              Hanya admin yang dapat mengakses halaman ini
            </p>
          </div>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password Admin
            </label>
            <PasswordInput
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                error ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="Masukkan password akun admin"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (error) setError('')
              }}
              required
              autoFocus
              disabled={loading}
            />
            {error && (
              <p className="mt-1 text-sm text-red-600 flex items-center">
                <span className="mr-1">⚠️</span>
                {error}
              </p>
            )}
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors duration-200 disabled:opacity-50"
              onClick={handleClose}
              disabled={loading}
            >
              Batal
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed min-w-[100px]"
              disabled={loading || !password.trim()}
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                  Verifikasi...
                </span>
              ) : 'Konfirmasi'}
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
    // Get current session first
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError || !session) {
      throw new Error('Silakan login terlebih dahulu')
    }

    // Re-authenticate with current user's email
    const { error } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password
    })

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        throw new Error('Password salah')
      }
      throw error
    }

    return true
  } catch (error) {
    console.error('Password verification error:', error)
    throw error
  }
}

/* ===== Utils ===== */
const HARI_OPTS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
const GRADE_OPTS = ['VII', 'VIII', 'IX', 'X', 'XI', 'XII']
const GRADE_ORDER = Object.fromEntries(GRADE_OPTS.map((g, i) => [g, i]))
const FORBIDDEN = /[.#$[\]]/
const DEFAULT_SCHEDULE_DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

let jsPdfPromise = null
const loadJsPdf = async () => {
  if (!jsPdfPromise) {
    jsPdfPromise = import('jspdf')
  }
  const mod = await jsPdfPromise
  return mod.jsPDF || mod.default
}

let autoTablePromise = null
const loadAutoTable = async () => {
  if (!autoTablePromise) {
    autoTablePromise = import('jspdf-autotable')
  }
  const mod = await autoTablePromise
  return mod.default || mod.autoTable || null
}

const slug = (s = '') => s.toString().trim().toLowerCase()
  .replace(/[^\w\s-]/g, '')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .slice(0, 80)

const toMinutes = (hhmm) => {
  const value = toTimeHHMM(hhmm)
  if (!value) return NaN
  const [h, m] = value.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN
  return (h * 60) + m
}

const toTimeHHMM = (hhmm) => {
  const value = String(hhmm || '').trim()
  if (!value) return ''
  const normalized = value.replace('.', ':')
  const match = normalized.match(/^(\d{1,2}):(\d{1,2})/)
  if (!match) return normalized.length >= 5 ? normalized.slice(0, 5) : normalized
  const hour = Math.max(0, Math.min(23, Number(match[1])))
  const minute = Math.max(0, Math.min(59, Number(match[2])))
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

const toTimeLabel = (hhmm) => toTimeHHMM(hhmm).replace(':', '.')

const toRangeLabel = (start, end) => `${toTimeLabel(start)}-${toTimeLabel(end)}`

const normalizeMapelInput = (value = '') => String(value || '').toUpperCase()

const normalizeMapelName = (value = '') =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()

const normalizeScheduleDay = (day) => {
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

const classSlug = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'kelas'

const buildSheetName = (source = '', used = new Set()) => {
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

const normalizeScheduleCellEntries = (entries = []) =>
  (entries || [])
    .map((item) => ({
      mapel: String(item?.mapel || '').trim(),
      guruNama: String(item?.guruNama || '').trim()
    }))
    .filter((item) => item.mapel || item.guruNama)

const buildScheduleCellExportText = (entries = []) =>
  entries
    .map((item) => {
      const mapel = item.mapel || '-'
      return item.guruNama ? `${mapel}\n${item.guruNama}` : mapel
    })
    .join('\n\n')

const buildScheduleCellExcelValue = (entries = []) => {
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

const buildScheduleMatrix = (rows = [], days = DEFAULT_SCHEDULE_DAYS) => {
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

const timesOverlap = (aStart, aEnd, bStart, bEnd) => {
  const as = toMinutes(aStart), ae = toMinutes(aEnd)
  const bs = toMinutes(bStart), be = toMinutes(bEnd)
  if ([as, ae, bs, be].some(Number.isNaN)) return false
  return as < be && bs < ae
}

const GRADE_REGEX = /^\s*(VII|VIII|IX|X|XI|XII)\b/i
const parseGrade = (name = '') => {
  const m = String(name || '').toUpperCase().match(GRADE_REGEX)
  return m ? m[1] : ''
}

const stripGradePrefix = (name = '') => {
  const g = parseGrade(name)
  if (!g) return name.trim()
  return name.toUpperCase().startsWith(g) ? name.slice(g.length).trim() : name.trim()
}

const makeClassName = (grade, suffix) => (grade + (suffix ? ' ' + suffix.trim() : '')).trim()

const normalizeClassSuffixInput = (value = '', grade = '') => {
  const selectedGrade = String(grade || '').toUpperCase().trim()
  let suffix = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')

  if (selectedGrade) {
    suffix = suffix.replace(new RegExp(`^${selectedGrade}\\b\\s*`, 'i'), '')
  }

  return suffix.trim()
}

/* quick helpers */
const confirmDelete = (msg = 'Yakin mau dihapus?') => window.confirm(msg)

let strukturSekolahTabPromise = null
const loadStrukturSekolahTab = () => {
  if (!strukturSekolahTabPromise) {
    strukturSekolahTabPromise = import('./kelas/StrukturSekolahTab')
  }
  return strukturSekolahTabPromise
}

let organisasiTabPromise = null
const loadOrganisasiTab = () => {
  if (!organisasiTabPromise) {
    organisasiTabPromise = import('./kelas/OrganisasiTab')
  }
  return organisasiTabPromise
}

const StrukturSekolahTab = React.lazy(loadStrukturSekolahTab)
const OrganisasiTab = React.lazy(loadOrganisasiTab)

const lazyTabLoaders = {
  struktur: loadStrukturSekolahTab,
  org: loadOrganisasiTab
}

const prefetchLazyTab = (key) => {
  const loader = lazyTabLoaders[key]
  if (loader) void loader()
}

function TabContentFallback({ label = 'Memuat tab...' }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
      <div className="flex items-center justify-center gap-3 text-sm font-medium text-gray-500">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-blue-600" />
        <span>{label}</span>
      </div>
    </div>
  )
}

/* ===== Component Utama: AKelas (Terkunci Password) ===== */
export default function AKelas() {
  const { pushToast } = useUIStore()

  /* ---------- LOCK SCREEN STATE ---------- */
  const [isAuthorized, setIsAuthorized] = useState(true)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [passwordLoading, setPasswordLoading] = useState(false)

  const handlePasswordConfirm = async (password) => {
    setPasswordLoading(true)
    try {
      await verifyPassword(password)
      setIsAuthorized(true)
      setPasswordModalOpen(false)
      pushToast('success', 'Akses diizinkan. Selamat datang di Manajemen Kelas & Jadwal.')
    } catch (error) {
      console.error('Password verification failed:', error)
      pushToast('error', error.message || 'Gagal verifikasi password')
    } finally {
      setPasswordLoading(false)
    }
  }

  const handlePasswordClose = () => {
    setPasswordModalOpen(false)
  }

  /* ---------- State Lama ---------- */
  const [tab, setTab] = useState('kelas')
  const [loading, setLoading] = useState(false)

  /* Data umum: guru & siswa */
  const [guruList, setGuruList] = useState([])
  const [siswaList, setSiswaList] = useState([])

  /* =========================================================
     TAB 1 — KELAS & JADWAL + STRUKTUR KELAS
  ========================================================= */
  const [kelas, setKelas] = useState([])
  const [filterGrade, setFilterGrade] = useState('')
  const [kelasSelected, setKelasSelected] = useState('')
  const [jadwal, setJadwal] = useState([])
  const [filterHari, setFilterHari] = useState('')
  const [settingsRow, setSettingsRow] = useState(null)
  const [academicPeriod, setAcademicPeriod] = useState(() => resolveAcademicPeriod())
  const [periodForm, setPeriodForm] = useState(() => {
    const current = getCurrentAcademicPeriod()
    return { tahunAjaran: current.tahunAjaran, semester: current.semester }
  })
  const [savingPeriod, setSavingPeriod] = useState(false)

  // Form buat kelas
  const [newGrade, setNewGrade] = useState('')
  const [newSuffix, setNewSuffix] = useState('')
  const [newAngkatan, setNewAngkatan] = useState('')
  const selObj = React.useMemo(() => kelas.find(k => k.id === kelasSelected) || null, [kelas, kelasSelected])

  // Struktur kelas
  const [waliGuruId, setWaliGuruId] = useState('')
  const [ketuaUid, setKetuaUid] = useState('')

  // Mata Pelajaran
  const [mapelList, setMapelList] = useState([])
  const [newMapel, setNewMapel] = useState('')

  // Form Jadwal
  const [form, setForm] = useState({ hari: '', mapel: '', guruId: '', jamMulai: '', jamSelesai: '' })
  const [editId, setEditId] = useState(null)
  const [editData, setEditData] = useState(null)
  const [exportClassId, setExportClassId] = useState('')
  const [exportFormat, setExportFormat] = useState('excel')
  const [exportingJadwal, setExportingJadwal] = useState(false)

  const PROMO_ALUMNI = '__ALUMNI__'
  const PROMO_MUTASI = '__MUTASI__'
  const [promotionModalOpen, setPromotionModalOpen] = useState(false)
  const [promotionMode, setPromotionMode] = useState('kelas')
  const [promotionFromKelas, setPromotionFromKelas] = useState('')
  const [promotionToKelas, setPromotionToKelas] = useState('')
  const [promotionFilterGrade, setPromotionFilterGrade] = useState('')
  const [promotionFilterKelas, setPromotionFilterKelas] = useState('')
  const [promotionSelectedIds, setPromotionSelectedIds] = useState([])
  const [promotionAlumniYear, setPromotionAlumniYear] = useState(String(new Date().getFullYear()))
  const [promotionExitReason, setPromotionExitReason] = useState('')
  const [promotionAdvancePeriod, setPromotionAdvancePeriod] = useState(false)
  const [promotionLoading, setPromotionLoading] = useState(false)

  /* ====== EFFECTS ====== */

  // Load guru & siswa setelah password benar
  useEffect(() => {
    if (!isAuthorized) return
    
    const loadData = async () => {
      setLoading(true)
      try {
        await Promise.all([
          loadSettings(),
          loadGuruList(),
          loadKelas(),
          loadMapelList()
        ])

        void loadSiswaList().catch(() => {})
      } catch (error) {
        console.error('Error loading initial data:', error)
      } finally {
        setLoading(false)
      }
    }
    
    loadData()
  }, [isAuthorized])

  // Load jadwal & struktur kelas ketika kelasSelected berubah
  useEffect(() => {
    if (!isAuthorized || !kelasSelected) return

    const loadKelasData = async () => {
      setLoading(true)
      try {
        await Promise.all([
          loadJadwal(),
          loadStrukturKelas()
        ])
      } catch (error) {
        console.error('Error loading kelas data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadKelasData()
  }, [isAuthorized, kelasSelected, academicPeriod.tahunAjaran, academicPeriod.semester])

  useEffect(() => {
    if (!exportClassId && kelasSelected) {
      setExportClassId(kelasSelected)
    }
  }, [exportClassId, kelasSelected])

  useEffect(() => {
    if (exportClassId === '__all__' && exportFormat === 'pdf') {
      setExportFormat('excel')
    }
  }, [exportClassId, exportFormat])

  useEffect(() => {
    if (!newGrade) return
    setNewAngkatan(inferCohortYear(newGrade, academicPeriod.startYear))
  }, [newGrade, academicPeriod.startYear])

  /* ================== LOADERS ================== */
  const loadSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('id, tahun_ajaran, semester_aktif')
        .order('id')
        .limit(1)
        .maybeSingle()

      if (error && error.code !== 'PGRST116') throw error

      const resolved = resolveAcademicPeriod(data || {})
      setSettingsRow(data || null)
      setAcademicPeriod(resolved)
      setPeriodForm({
        tahunAjaran: resolved.tahunAjaran,
        semester: resolved.semester
      })
    } catch (error) {
      console.error('Error loading settings:', error)
      pushToast('error', 'Gagal memuat tahun ajaran aktif')
      throw error
    }
  }, [pushToast])

  const loadGuruList = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, nama, email, role')
        .in('role', ['guru', 'teacher'])
        .order('nama')

      if (error) throw error

      const guru = data.map(u => {
        const name = u.nama || u.email || u.id
        return {
          id: u.id,
          name,
          label: name + (u.email ? ` (${u.email})` : '')
        }
      })
      setGuruList(guru)
    } catch (error) {
      console.error('Error loading guru:', error)
      pushToast('error', 'Gagal memuat data guru')
      throw error
    }
  }, [pushToast])

  const loadSiswaList = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, nama, email, kelas, role, status, angkatan')
        .eq('role', 'siswa')
        .order('kelas')
        .order('nama')

      if (error) throw error

      const siswa = data.map(u => ({
        uid: u.id,
        nama: u.nama || u.email || u.id,
        email: u.email || '',
        kelas: u.kelas || '',
        status: u.status || 'active',
        angkatan: u.angkatan || ''
      }))
      setSiswaList(siswa)
    } catch (error) {
      console.error('Error loading siswa:', error)
      pushToast('error', 'Gagal memuat data siswa')
      throw error
    }
  }, [pushToast])

  const loadKelas = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('kelas')
        .select('*')
        .order('grade')
        .order('suffix')

      if (error) throw error

      const rows = data.map(k => ({
        id: k.id,
        nama: k.nama || k.id,
        grade: k.grade || parseGrade(k.id),
        suffix: k.suffix || stripGradePrefix(k.nama || k.id),
        angkatan: k.angkatan || '',
        tahunAjaran: k.tahun_ajaran || '',
        semester: k.semester || '',
        isActive: k.is_active !== false,
        ...k
      }))

      rows.sort((a, b) => {
        const ag = GRADE_ORDER[a.grade] ?? 999
        const bg = GRADE_ORDER[b.grade] ?? 999
        if (ag !== bg) return ag - bg
        return (a.suffix || '').localeCompare(b.suffix || '', 'id')
      })

      setKelas(rows)
      if (!kelasSelected && rows.length) {
        setKelasSelected(rows[0].id)
      }
    } catch (error) {
      console.error('Error loading kelas:', error)
      pushToast('error', 'Gagal memuat data kelas')
      throw error
    }
  }, [kelasSelected, pushToast])

  const loadJadwal = useCallback(async () => {
    if (!kelasSelected) return

    try {
      const { data, error } = await supabase
        .from('jadwal')
        .select('*')
        .eq('kelas_id', kelasSelected)
        .eq('tahun_ajaran', academicPeriod.tahunAjaran)
        .eq('semester', academicPeriod.semester)
        .order('hari')
        .order('jam_mulai')

      if (error) throw error

      const rows = data.map(j => ({
        id: j.id,
        hari: j.hari,
        mapel: normalizeMapelName(j.mapel),
        guruId: j.guru_id,
        guruNama: j.guru_nama || '',
        jamMulai: toTimeHHMM(j.jam_mulai),
        jamSelesai: toTimeHHMM(j.jam_selesai),
        tahunAjaran: j.tahun_ajaran || academicPeriod.tahunAjaran,
        semester: j.semester || academicPeriod.semester
      }))

      rows.sort((a, b) => {
        const ai = HARI_OPTS.indexOf(a.hari)
        const bi = HARI_OPTS.indexOf(b.hari)
        if (ai !== bi) return ai - bi
        return toMinutes(a.jamMulai) - toMinutes(b.jamMulai)
      })

      setJadwal(rows)
    } catch (error) {
      console.error('Error loading jadwal:', error)
      pushToast('error', 'Gagal memuat jadwal')
      throw error
    }
  }, [academicPeriod.semester, academicPeriod.tahunAjaran, kelasSelected, pushToast])

  const loadStrukturKelas = useCallback(async () => {
    if (!kelasSelected) return

    try {
      const { data, error } = await supabase
        .from('kelas_struktur')
        .select('*')
        .eq('kelas_id', kelasSelected)
        .maybeSingle()

      if (error && error.code !== 'PGRST116') throw error

      setWaliGuruId(data?.wali_guru_id || '')
      setKetuaUid(data?.ketua_siswa_id || '')
    } catch (error) {
      console.error('Error loading struktur kelas:', error)
      pushToast('error', 'Gagal memuat struktur kelas')
      throw error
    }
  }, [kelasSelected, pushToast])

  const loadMapelList = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('mata_pelajaran')
        .select('*')
        .order('nama')

      if (error) throw error

      const rows = data.map(m => ({
        ...m,
        id: m.id,
        nama: normalizeMapelName(m.nama || m.id)
      }))

      setMapelList(rows)
    } catch (error) {
      console.error('Error loading mata pelajaran:', error)
      pushToast('error', 'Gagal memuat mata pelajaran')
      throw error
    }
  }, [pushToast])

  /* ================== DERIVED DATA ================== */
  const kelasByGrade = React.useMemo(() => {
    return filterGrade ? kelas.filter(k => k.grade === filterGrade) : kelas
  }, [kelas, filterGrade])

  const siswaDiKelasTerpilih = React.useMemo(() => {
    return siswaList.filter(s => s.kelas === kelasSelected)
  }, [siswaList, kelasSelected])

  const jadwalToShow = React.useMemo(() => {
    if (!filterHari) return jadwal
    return jadwal.filter(j => j.hari === filterHari)
  }, [jadwal, filterHari])

  const kelasNameById = React.useMemo(() => {
    const map = {}
    kelas.forEach((item) => {
      map[item.id] = (item.nama || item.id || '').toUpperCase()
    })
    return map
  }, [kelas])

  const exportDays = React.useMemo(() => {
    const days = [...DEFAULT_SCHEDULE_DAYS]
    jadwal.forEach((item) => {
      const day = normalizeScheduleDay(item.hari)
      if (day && !days.includes(day)) {
        days.push(day)
      }
    })
    return days
  }, [jadwal])

  const jadwalMatrix = React.useMemo(
    () => buildScheduleMatrix(jadwal, exportDays),
    [jadwal, exportDays]
  )

  const kelasOptions = React.useMemo(() => (
    kelas.map((item) => ({
      value: item.id,
      label: (item.nama || item.id || '').toUpperCase(),
      grade: item.grade || parseGrade(item.id)
    }))
  ), [kelas])

  const gradeLabelsForPromotion = React.useMemo(() => {
    const set = new Set(GRADE_OPTS)
    kelas.forEach((item) => {
      const grade = item.grade || parseGrade(item.id)
      if (grade) set.add(grade)
    })
    return Array.from(set).sort((a, b) => (GRADE_ORDER[a] ?? 999) - (GRADE_ORDER[b] ?? 999))
  }, [kelas])

  const activeSiswaList = React.useMemo(() => (
    siswaList.filter((siswa) => {
      const status = String(siswa.status || 'active').toLowerCase()
      return status === 'active' || status === ''
    })
  ), [siswaList])

  const promotionCandidateSiswa = React.useMemo(() => {
    let rows = activeSiswaList
    if (promotionFilterGrade) {
      rows = rows.filter((siswa) => parseGrade(siswa.kelas || '') === promotionFilterGrade)
    }
    if (promotionFilterKelas) {
      rows = rows.filter((siswa) => siswa.kelas === promotionFilterKelas)
    }

    return [...rows].sort((a, b) => {
      const classCompare = getKelasName(a.kelas).localeCompare(getKelasName(b.kelas), 'id')
      if (classCompare !== 0) return classCompare
      return (a.nama || '').localeCompare(b.nama || '', 'id')
    })
  }, [activeSiswaList, promotionFilterGrade, promotionFilterKelas, kelas])

  const nextAcademicPeriod = React.useMemo(
    () => getNextAcademicPeriod({
      tahunAjaran: academicPeriod.tahunAjaran,
      semester: academicPeriod.semester
    }),
    [academicPeriod.semester, academicPeriod.tahunAjaran]
  )

  function guruNameById(id) {
    return guruList.find(g => g.id === id)?.name || ''
  }

  function siswaNameByUid(uid) {
    return siswaList.find(s => s.uid === uid)?.nama || ''
  }

  function getKelasName(kelasId) {
    return kelas.find((item) => item.id === kelasId)?.nama || kelasId || '-'
  }

  function buildJadwalKey({ hari, mapel, jamMulai, jamSelesai }) {
    const cleanMapel = normalizeMapelName(mapel).replace(/\s+/g, '_').replace(/[^\w-]/g, '')
    const cleanHari = (hari || '').replace(/\s+/g, '_')
    const cleanJamMulai = (jamMulai || '').replace(/:/g, '')
    const cleanJamSelesai = (jamSelesai || '').replace(/:/g, '')
    const cleanYear = (academicPeriod.tahunAjaran || '').replace(/[^\w]/g, '')
    const cleanSemester = (academicPeriod.semester || '').replace(/[^\w]/g, '')

    return `${kelasSelected}-${cleanYear}-${cleanSemester}-${cleanHari}-${cleanMapel}-${cleanJamMulai}-${cleanJamSelesai}`
  }

  async function persistAcademicPeriod(nextPeriod, { silent = false } = {}) {
    const tahunAjaran = normalizeAcademicYear(nextPeriod?.tahunAjaran)
    const semester = normalizeSemester(nextPeriod?.semester)

    if (!tahunAjaran || !semester) {
      throw new Error('Tahun ajaran atau semester tidak valid')
    }

    const payload = {
      tahun_ajaran: tahunAjaran,
      semester_aktif: semester,
      updated_at: new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('settings')
      .upsert(payload)

    if (error) throw error

    const resolved = resolveAcademicPeriod(payload)
    setSettingsRow(Array.isArray(data) ? data[0] : data || settingsRow)
    setAcademicPeriod(resolved)
    setPeriodForm({ tahunAjaran: resolved.tahunAjaran, semester: resolved.semester })
    if (!silent) pushToast('success', `Periode aktif disimpan: ${resolved.tahunAjaran} - ${resolved.semester}`)

    return resolved
  }

  async function simpanPeriodeAktif() {
    try {
      setSavingPeriod(true)
      await persistAcademicPeriod(periodForm)
      setJadwal([])
      await loadKelas()
    } catch (error) {
      console.error('Error saving academic period:', error)
      pushToast('error', error.message || 'Gagal menyimpan tahun ajaran aktif')
    } finally {
      setSavingPeriod(false)
    }
  }

  async function hasConflict({ hari, jamMulai, jamSelesai, guruId, mapel, kelasId }, ignoreId = null) {
    if (!kelasId) return 'Kelas belum dipilih'

    try {
      // Validasi waktu
      if (toMinutes(jamMulai) >= toMinutes(jamSelesai)) {
        return 'Jam mulai harus lebih awal dari jam selesai'
      }

      // Validasi durasi minimal (30 menit)
      const durasi = toMinutes(jamSelesai) - toMinutes(jamMulai)
      if (durasi < 30) {
        return 'Durasi pelajaran minimal 30 menit'
      }

      // Bentrok di kelas yang sama
      let classQuery = supabase
        .from('jadwal')
        .select('*')
        .eq('kelas_id', kelasId)
        .eq('hari', hari)
        .eq('tahun_ajaran', academicPeriod.tahunAjaran)
        .eq('semester', academicPeriod.semester)

      if (ignoreId) {
        classQuery = classQuery.neq('id', ignoreId)
      }

      const { data: sameClassSchedule, error: classError } = await classQuery
      if (classError) throw classError

      for (const j of sameClassSchedule || []) {
        if (timesOverlap(jamMulai, jamSelesai, j.jam_mulai, j.jam_selesai)) {
          return `Konflik dengan ${j.mapel} di kelas ini (${j.jam_mulai}-${j.jam_selesai})`
        }
      }

      // Bentrok guru
      if (guruId) {
        let teacherQuery = supabase
          .from('jadwal')
          .select('*')
          .eq('guru_id', guruId)
          .eq('hari', hari)
          .eq('tahun_ajaran', academicPeriod.tahunAjaran)
          .eq('semester', academicPeriod.semester)

        if (ignoreId) {
          teacherQuery = teacherQuery.neq('id', ignoreId)
        }

        const { data: teacherSchedule, error: teacherError } = await teacherQuery
        if (teacherError) throw teacherError

        for (const j of teacherSchedule || []) {
          if (timesOverlap(jamMulai, jamSelesai, j.jam_mulai, j.jam_selesai)) {
            return `Guru bentrok di kelas ${j.kelas_id} (${j.mapel} ${j.jam_mulai}-${j.jam_selesai})`
          }
        }
      }

      return null
    } catch (error) {
      console.error('Error checking conflict:', error)
      return error?.message
        ? `Error memeriksa konflik jadwal: ${error.message}`
        : 'Error memeriksa konflik jadwal'
    }
  }

  function openPromotionModal() {
    setPromotionMode('kelas')
    setPromotionFromKelas(kelasSelected || '')
    setPromotionToKelas('')
    setPromotionFilterGrade('')
    setPromotionFilterKelas(kelasSelected || '')
    setPromotionSelectedIds([])
    setPromotionAlumniYear(String(new Date().getFullYear()))
    setPromotionExitReason('')
    setPromotionAdvancePeriod(false)
    setPromotionModalOpen(true)
  }

  function closePromotionModal() {
    setPromotionModalOpen(false)
    setPromotionLoading(false)
    setPromotionSelectedIds([])
    setPromotionExitReason('')
  }

  function togglePromotionSelect(uid) {
    setPromotionSelectedIds((prev) => (
      prev.includes(uid) ? prev.filter((item) => item !== uid) : [...prev, uid]
    ))
  }

  function togglePromotionSelectAllVisible() {
    const visibleIds = promotionCandidateSiswa.map((siswa) => siswa.uid)
    if (!visibleIds.length) return

    const allSelected = visibleIds.every((uid) => promotionSelectedIds.includes(uid))
    setPromotionSelectedIds((prev) => (
      allSelected
        ? prev.filter((uid) => !visibleIds.includes(uid))
        : Array.from(new Set([...prev, ...visibleIds]))
    ))
  }

  async function handlePromotion() {
    try {
      if (!promotionToKelas) {
        pushToast('error', 'Pilih tujuan kenaikan/pindah kelas terlebih dahulu')
        return
      }

      let selectedSiswa = []
      if (promotionMode === 'kelas') {
        if (!promotionFromKelas) {
          pushToast('error', 'Pilih kelas asal terlebih dahulu')
          return
        }
        selectedSiswa = activeSiswaList.filter((siswa) => siswa.kelas === promotionFromKelas)
      } else {
        if (!promotionSelectedIds.length) {
          pushToast('error', 'Pilih minimal 1 siswa')
          return
        }
        selectedSiswa = activeSiswaList.filter((siswa) => promotionSelectedIds.includes(siswa.uid))
      }

      const selectedIds = selectedSiswa.map((siswa) => siswa.uid)
      if (!selectedIds.length) {
        pushToast('error', 'Tidak ada siswa aktif yang bisa diproses')
        return
      }

      const isAlumniMode = promotionToKelas === PROMO_ALUMNI
      const isMutasiMode = promotionToKelas === PROMO_MUTASI
      const isExitMode = isAlumniMode || isMutasiMode
      const fromLabel = promotionMode === 'kelas'
        ? getKelasName(promotionFromKelas)
        : 'Siswa terpilih'
      const toLabel = isExitMode
        ? (isAlumniMode ? 'Alumni / Lulus' : 'Mutasi / Pindah Sekolah')
        : getKelasName(promotionToKelas)

      if (!isExitMode && promotionMode === 'kelas' && promotionFromKelas === promotionToKelas) {
        pushToast('error', 'Kelas asal dan kelas tujuan tidak boleh sama')
        return
      }

      if (isExitMode && !promotionExitReason.trim()) {
        pushToast('error', 'Alasan/catatan wajib diisi untuk Alumni atau Mutasi')
        return
      }

      const fromGrades = Array.from(new Set(selectedSiswa.map((siswa) => parseGrade(siswa.kelas)).filter(Boolean)))
      const toGrade = !isExitMode ? parseGrade(promotionToKelas) : ''
      const lines = [
        `Periode aktif: ${academicPeriod.tahunAjaran} - ${academicPeriod.semester}`,
        `Sumber: ${fromLabel}`,
        `Tujuan: ${toLabel}`,
        `Total siswa: ${selectedIds.length}`
      ]

      if (isAlumniMode) {
        const eligible = selectedSiswa.filter((siswa) => parseGrade(siswa.kelas) === 'XII')
        lines.push('', `Alumni hanya memproses kelas XII. Eligible: ${eligible.length}, dilewati: ${selectedIds.length - eligible.length}.`)
        lines.push(`Tahun lulus: ${promotionAlumniYear || new Date().getFullYear()}`)
      }

      if (!isExitMode && fromGrades.length === 1 && toGrade && fromGrades[0] !== toGrade) {
        lines.push('', `Perubahan tingkatan: ${fromGrades[0]} ke ${toGrade}.`)
      }

      if (promotionAdvancePeriod) {
        lines.push('', `Setelah proses, periode aktif akan diganti ke ${nextAcademicPeriod.tahunAjaran} - ${nextAcademicPeriod.semester}.`)
      }

      lines.push('', 'Lanjutkan?')
      if (!window.confirm(lines.join('\n'))) return

      setPromotionLoading(true)
      const now = new Date().toISOString()

      if (isExitMode) {
        let eligibleSiswa = selectedSiswa
        if (isAlumniMode) {
          eligibleSiswa = selectedSiswa.filter((siswa) => parseGrade(siswa.kelas) === 'XII')
        }

        if (!eligibleSiswa.length) {
          pushToast('error', 'Tidak ada siswa eligible untuk diproses')
          return
        }

        const eligibleIds = eligibleSiswa.map((siswa) => siswa.uid)
        const affectedClasses = Array.from(new Set(eligibleSiswa.map((siswa) => siswa.kelas).filter(Boolean)))

        await supabase
          .from('kelas_struktur')
          .update({ ketua_siswa_id: null, ketua_siswa_nama: null, updated_at: now })
          .in('ketua_siswa_id', eligibleIds)

        const payload = {
          status: isAlumniMode ? 'alumni' : 'mutasi',
          disabled_at: now,
          alasan_nonaktif: `${toLabel}. Kelas terakhir: ${fromLabel}. ${promotionExitReason.trim()}`.trim(),
          rfid_uid: null,
          kelas: '',
          updated_at: now
        }

        if (isAlumniMode) {
          payload.tahun_lulus = Number(promotionAlumniYear) || new Date().getFullYear()
        }

        const { error } = await supabase
          .from('profiles')
          .update(payload)
          .in('id', eligibleIds)

        if (error) throw error

        if (affectedClasses.length) {
          await supabase
            .from('kelas_struktur')
            .update({ ketua_siswa_id: null, ketua_siswa_nama: null, updated_at: now })
            .in('kelas_id', affectedClasses)
        }

        pushToast('success', `${toLabel} berhasil diproses untuk ${eligibleIds.length} siswa`)
      } else {
        const targetClass = kelas.find((item) => item.id === promotionToKelas)
        const targetGrade = targetClass?.grade || parseGrade(promotionToKelas)
        const targetCohort = targetClass?.angkatan || inferCohortYear(targetGrade, academicPeriod.startYear)

        const { error } = await supabase
          .from('profiles')
          .update({ kelas: promotionToKelas, updated_at: now })
          .in('id', selectedIds)

        if (error) throw error

        const missingCohortIds = selectedSiswa
          .filter((siswa) => !String(siswa.angkatan || '').trim())
          .map((siswa) => siswa.uid)

        if (missingCohortIds.length) {
          await supabase
            .from('profiles')
            .update({ angkatan: targetCohort, updated_at: now })
            .in('id', missingCohortIds)
        }

        const affectedClasses = Array.from(new Set([
          ...selectedSiswa.map((siswa) => siswa.kelas).filter(Boolean),
          promotionToKelas
        ]))
        await supabase
          .from('kelas_struktur')
          .update({ ketua_siswa_id: null, ketua_siswa_nama: null, updated_at: now })
          .in('kelas_id', affectedClasses)

        pushToast('success', `Berhasil memindahkan ${selectedIds.length} siswa ke ${targetClass?.nama || promotionToKelas}`)
      }

      if (promotionAdvancePeriod) {
        await persistAcademicPeriod(nextAcademicPeriod, { silent: true })
        pushToast('success', `Periode aktif diperbarui ke ${nextAcademicPeriod.tahunAjaran} - ${nextAcademicPeriod.semester}`)
      }

      closePromotionModal()
      await Promise.all([loadSiswaList(), loadStrukturKelas(), loadKelas()])
    } catch (error) {
      console.error('Error running promotion:', error)
      pushToast('error', error.message || 'Gagal memproses kenaikan kelas')
    } finally {
      setPromotionLoading(false)
    }
  }

  /* ------- KELAS ------- */
  async function tambahKelas() {
    const grade = (newGrade || '').toUpperCase().trim()
    const suffix = normalizeClassSuffixInput(newSuffix, grade).toUpperCase()
    
    if (!GRADE_OPTS.includes(grade)) {
      pushToast('error', 'Pilih grade: VII–XII.')
      return
    }
    
    if (!suffix) {
      pushToast('error', 'Nama/sufiks kelas harus diisi.')
      return
    }
    
    if (FORBIDDEN.test(suffix)) {
      pushToast('error', 'Sufiks tidak boleh mengandung . # $ [ ]')
      return
    }

    const nama = makeClassName(grade, suffix).toUpperCase()
    const id = slug(nama)
    const angkatan = String(newAngkatan || inferCohortYear(grade, academicPeriod.startYear)).trim()

    try {
      setLoading(true)
      
      // Cek kelas di tenant aktif. Nama dicek juga karena backend bisa menambahkan
      // suffix internal pada id saat slug bentrok dengan tenant lain.
      const [existingById, existingByName] = await Promise.all([
        supabase
          .from('kelas')
          .select('id')
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('kelas')
          .select('id')
          .eq('nama', nama)
          .maybeSingle()
      ])

      if (existingById.error || existingByName.error) {
        throw existingById.error || existingByName.error
      }

      if (existingById.data || existingByName.data) {
        pushToast('error', 'Kelas sudah ada.')
        return
      }

      const { data, error } = await supabase
        .from('kelas')
        .insert({
          id,
          nama,
          grade,
          suffix,
          angkatan,
          tahun_ajaran: academicPeriod.tahunAjaran,
          semester: academicPeriod.semester,
          is_active: true,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      const insertedRow = Array.isArray(data) ? data[0] : data
      const savedId = insertedRow?.id || id

      pushToast('success', `Kelas ${nama} berhasil ditambahkan`)
      setNewGrade('')
      setNewSuffix('')
      setNewAngkatan('')
      setKelasSelected(savedId)
      await loadKelas()
    } catch (error) {
      console.error('Error adding kelas:', error)
      pushToast('error', error.message || 'Gagal menambah kelas')
    } finally {
      setLoading(false)
    }
  }

  async function hapusKelas(id) {
    if (!confirmDelete(`Yakin mau hapus kelas? Semua data terkait (jadwal, struktur) juga akan dihapus.`)) return

    try {
      setLoading(true)

      // Cek siswa
      const { data: siswaData, error: siswaError } = await supabase
        .from('profiles')
        .select('id, nama, kelas')
        .eq('kelas', id)

      if (siswaError) throw siswaError

      if (siswaData && siswaData.length > 0) {
        const siswaNames = siswaData.slice(0, 3).map(s => s.nama).join(', ')
        const sisa = siswaData.length > 3 ? ` dan ${siswaData.length - 3} lainnya` : ''
        
        pushToast('error', 
          `Tidak bisa hapus: kelas masih digunakan oleh ${siswaData.length} siswa. 
          ${siswaNames}${sisa}. Pindahkan siswa terlebih dahulu.`)
        return
      }

      // Hapus terkait dalam urutan yang benar
      await supabase.from('jam_kosong').delete().eq('kelas', id)
      await supabase.from('absensi_settings').delete().eq('kelas', id)
      await supabase.from('absensi').delete().eq('kelas', id)
      await supabase.from('tugas').delete().eq('kelas', id)
      await supabase.from('jadwal').delete().eq('kelas_id', id)
      await supabase.from('kelas_struktur').delete().eq('kelas_id', id)

      const { error } = await supabase
        .from('kelas')
        .delete()
        .eq('id', id)

      if (error) throw error

      pushToast('success', 'Kelas dan semua data terkait berhasil dihapus')
      if (kelasSelected === id) setKelasSelected('')
      await loadKelas()
    } catch (error) {
      console.error('Error deleting kelas:', error)
      
      if (error.code === '23503') {
        pushToast('error', 'Tidak dapat menghapus kelas karena masih terkait dengan data lain.')
      } else {
        pushToast('error', 'Gagal menghapus kelas: ' + (error.message || 'Unknown error'))
      }
    } finally {
      setLoading(false)
    }
  }

  /* ------- STRUKTUR KELAS ------- */
  async function simpanStrukturKelas() {
    if (!kelasSelected) {
      pushToast('error', 'Pilih kelas terlebih dahulu.')
      return
    }

    try {
      setLoading(true)
      const payload = {
        kelas_id: kelasSelected,
        wali_guru_id: waliGuruId || null,
        wali_guru_nama: waliGuruId ? guruNameById(waliGuruId) : '',
        ketua_siswa_id: ketuaUid || null,
        ketua_siswa_nama: ketuaUid ? siswaNameByUid(ketuaUid) : '',
        updated_at: new Date().toISOString()
      }

      const { error } = await supabase
        .from('kelas_struktur')
        .upsert(payload, { onConflict: 'kelas_id' })

      if (error) throw error

      pushToast('success', 'Struktur kelas berhasil disimpan')
    } catch (error) {
      console.error('Error saving struktur:', error)
      pushToast('error', 'Gagal menyimpan struktur kelas')
    } finally {
      setLoading(false)
    }
  }

  async function kosongkanStrukturKelas() {
    if (!kelasSelected) return
    if (!confirmDelete('Yakin mau mengosongkan struktur kelas?')) return

    try {
      setLoading(true)
      const { error } = await supabase
        .from('kelas_struktur')
        .delete()
        .eq('kelas_id', kelasSelected)

      if (error) throw error

      setWaliGuruId('')
      setKetuaUid('')
      pushToast('success', 'Struktur kelas berhasil dikosongkan')
    } catch (error) {
      console.error('Error clearing struktur:', error)
      pushToast('error', 'Gagal mengosongkan struktur')
    } finally {
      setLoading(false)
    }
  }

  /* ------- MATA PELAJARAN ------- */
  async function tambahMapel() {
    const nama = normalizeMapelName(newMapel)
    if (!nama) {
      pushToast('error', 'Nama mata pelajaran harus diisi')
      return
    }
    
    if (nama.length < 2) {
      pushToast('error', 'Nama mata pelajaran minimal 2 karakter')
      return
    }
    
    if (FORBIDDEN.test(nama)) {
      pushToast('error', 'Nama mapel tidak boleh mengandung . # $ [ ]')
      return
    }

    const id = slug(nama)

    try {
      setLoading(true)
      
      // Cek apakah sudah ada
      const { data: existing } = await supabase
        .from('mata_pelajaran')
        .select('id')
        .eq('id', id)
        .single()

      if (existing) {
        pushToast('error', 'Mata pelajaran sudah ada.')
        return
      }

      const { error } = await supabase
        .from('mata_pelajaran')
        .insert({
          id,
          nama,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      pushToast('success', `Mata pelajaran "${nama}" berhasil ditambahkan`)
      setNewMapel('')
      await loadMapelList()
      
      // Update form jadwal jika mapel ini dipilih
      if (form.mapel === '') {
        setForm(f => ({ ...f, mapel: nama }))
      }
    } catch (error) {
      console.error('Error adding mapel:', error)
      pushToast('error', error.message || 'Gagal menambah mata pelajaran')
    } finally {
      setLoading(false)
    }
  }

  async function hapusMapel(mapel) {
    if (!confirmDelete(`Hapus mata pelajaran "${mapel.nama}"?`)) return

    try {
      setLoading(true)
      
      // Cek apakah masih digunakan di jadwal
      const { data: usedJadwal, error: checkError } = await supabase
        .from('jadwal')
        .select('kelas_id, mapel')

      if (checkError) throw checkError

      const usedByMapel = (usedJadwal || []).find(
        (row) => normalizeMapelName(row.mapel) === normalizeMapelName(mapel.nama)
      )

      if (usedByMapel) {
        pushToast('error', 
          `Tidak bisa hapus: Mata pelajaran "${mapel.nama}" masih dipakai di jadwal. 
          Hapus semua jadwal dengan mapel ini terlebih dahulu.`)
        return
      }

      const { error } = await supabase
        .from('mata_pelajaran')
        .delete()
        .eq('id', mapel.id)

      if (error) throw error

      pushToast('success', 'Mata pelajaran berhasil dihapus')
      await loadMapelList()
    } catch (error) {
      console.error('Error deleting mapel:', error)
      pushToast('error', 'Gagal menghapus mata pelajaran')
    } finally {
      setLoading(false)
    }
  }

  /* ------- JADWAL ------- */
  async function tambahJadwal(e) {
    e?.preventDefault?.()
    if (!kelasSelected) {
      pushToast('error', 'Pilih kelas terlebih dahulu.')
      return
    }

    const { hari, guruId } = form
    const jamMulai = toTimeHHMM(form.jamMulai)
    const jamSelesai = toTimeHHMM(form.jamSelesai)
    const mapel = normalizeMapelName(form.mapel)

    // Validasi
    if (!hari || !mapel || !jamMulai || !jamSelesai) {
      pushToast('error', 'Lengkapi semua field yang wajib (Hari, Mapel, Jam Mulai, Jam Selesai).')
      return
    }

    try {
      setLoading(true)

      const conflictMsg = await hasConflict({
        hari,
        jamMulai,
        jamSelesai,
        guruId,
        mapel,
        kelasId: kelasSelected
      })

      if (conflictMsg) {
        pushToast('error', conflictMsg)
        return
      }

      const id = buildJadwalKey({ hari, mapel, jamMulai, jamSelesai })
      const guruNama = guruId ? guruNameById(guruId) : ''

      const { error } = await supabase
        .from('jadwal')
        .insert({
          id,
          kelas_id: kelasSelected,
          hari,
          mapel,
          guru_id: guruId || null,
          guru_nama: guruNama,
          jam_mulai: jamMulai,
          jam_selesai: jamSelesai,
          tahun_ajaran: academicPeriod.tahunAjaran,
          semester: academicPeriod.semester,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      pushToast('success', 'Jadwal berhasil ditambahkan')
      setForm({ hari: '', mapel: '', guruId: '', jamMulai: '', jamSelesai: '' })
      await loadJadwal()
    } catch (error) {
      console.error('Error adding jadwal:', error)
      
      if (error.code === '23505') {
        pushToast('error', 'Jadwal dengan kombinasi ini sudah ada.')
      } else {
        pushToast('error', `Gagal menambah jadwal: ${error.message}`)
      }
    } finally {
      setLoading(false)
    }
  }

  async function hapusJadwal(id) {
    if (!confirmDelete('Yakin mau menghapus jadwal ini?')) return

    try {
      setLoading(true)
      const { error } = await supabase
        .from('jadwal')
        .delete()
        .eq('id', id)
        .eq('kelas_id', kelasSelected)

      if (error) throw error

      pushToast('success', 'Jadwal berhasil dihapus')
      if (editId === id) {
        setEditId(null)
        setEditData(null)
      }
      await loadJadwal()
    } catch (error) {
      console.error('Error deleting jadwal:', error)
      pushToast('error', 'Gagal menghapus jadwal')
    } finally {
      setLoading(false)
    }
  }

  function startEdit(row) {
    setEditId(row.id)
    setEditData({ ...row })
  }

  function cancelEdit() {
    setEditId(null)
    setEditData(null)
  }

  async function saveEdit() {
    if (!editData) return

    const { hari, guruId } = editData
    const jamMulai = toTimeHHMM(editData.jamMulai)
    const jamSelesai = toTimeHHMM(editData.jamSelesai)
    const mapel = normalizeMapelName(editData.mapel)

    if (!hari || !mapel || !jamMulai || !jamSelesai) {
      pushToast('error', 'Lengkapi semua field yang wajib.')
      return
    }

    try {
      setLoading(true)

      const conflictMsg = await hasConflict({
        hari,
        jamMulai,
        jamSelesai,
        guruId,
        mapel,
        kelasId: kelasSelected
      }, editId)

      if (conflictMsg) {
        pushToast('error', conflictMsg)
        return
      }

      const newId = buildJadwalKey({ hari, mapel, jamMulai, jamSelesai })
      const guruNama = guruId ? guruNameById(guruId) : ''

      if (newId !== editId) {
        // Hapus yang lama dan buat yang baru
        await supabase
          .from('jadwal')
          .delete()
          .eq('id', editId)
          .eq('kelas_id', kelasSelected)

        const { error } = await supabase
          .from('jadwal')
          .insert({
            id: newId,
            kelas_id: kelasSelected,
            hari,
            mapel,
            guru_id: guruId || null,
            guru_nama: guruNama,
            jam_mulai: jamMulai,
            jam_selesai: jamSelesai,
            tahun_ajaran: academicPeriod.tahunAjaran,
            semester: academicPeriod.semester,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })

        if (error) throw error
      } else {
        // Update yang sudah ada
        const { error } = await supabase
          .from('jadwal')
          .update({
            hari,
            mapel,
            guru_id: guruId || null,
            guru_nama: guruNama,
            jam_mulai: jamMulai,
            jam_selesai: jamSelesai,
            tahun_ajaran: academicPeriod.tahunAjaran,
            semester: academicPeriod.semester,
            updated_at: new Date().toISOString()
          })
          .eq('id', editId)
          .eq('kelas_id', kelasSelected)

        if (error) throw error
      }

      pushToast('success', 'Jadwal berhasil diupdate')
      setEditId(null)
      setEditData(null)
      await loadJadwal()
    } catch (error) {
      console.error('Error saving jadwal:', error)
      pushToast('error', 'Gagal menyimpan jadwal')
    } finally {
      setLoading(false)
    }
  }

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const sortJadwalRows = (rows) => {
    return [...(rows || [])].sort((a, b) => {
      const aiRaw = HARI_OPTS.indexOf(normalizeScheduleDay(a.hari))
      const biRaw = HARI_OPTS.indexOf(normalizeScheduleDay(b.hari))
      const ai = aiRaw >= 0 ? aiRaw : 999
      const bi = biRaw >= 0 ? biRaw : 999
      if (ai !== bi) return ai - bi
      return toMinutes(a.jamMulai) - toMinutes(b.jamMulai)
    })
  }

  const normalizeScheduleRow = (row) => ({
    id: row?.id || '',
    kelasId: row?.kelas_id || '',
    hari: normalizeScheduleDay(row?.hari),
    mapel: normalizeMapelName(row?.mapel),
    guruId: row?.guru_id || '',
    guruNama: row?.guru_nama || '',
    jamMulai: toTimeHHMM(row?.jam_mulai || row?.jamMulai),
    jamSelesai: toTimeHHMM(row?.jam_selesai || row?.jamSelesai)
  })

  const resolveExportClassName = (classId) => {
    return kelasNameById[classId] || String(classId || '').toUpperCase()
  }

  const collectExportPayload = async () => {
    const targetClassId = exportClassId || kelasSelected
    if (!targetClassId) {
      throw new Error('Pilih kelas tujuan export terlebih dahulu.')
    }

    if (targetClassId === '__all__') {
      const { data, error } = await supabase
        .from('jadwal')
        .select('*')
        .eq('tahun_ajaran', academicPeriod.tahunAjaran)
        .eq('semester', academicPeriod.semester)
        .order('kelas_id')
        .order('hari')
        .order('jam_mulai')

      if (error) throw error

      const grouped = {}
      ;(data || []).forEach((raw) => {
        const row = normalizeScheduleRow(raw)
        if (!row.kelasId) return
        if (!grouped[row.kelasId]) grouped[row.kelasId] = []
        grouped[row.kelasId].push(row)
      })

      const allClassIds = Array.from(new Set([
        ...kelas.map((item) => item.id),
        ...Object.keys(grouped)
      ]))

      const classPayloads = allClassIds.map((id) => {
        const rows = sortJadwalRows(grouped[id] || [])
        const days = [...DEFAULT_SCHEDULE_DAYS]
        rows.forEach((row) => {
          const day = normalizeScheduleDay(row.hari)
          if (day && !days.includes(day)) days.push(day)
        })

        return {
          classId: id,
          className: resolveExportClassName(id),
          rows,
          days,
          matrix: buildScheduleMatrix(rows, days)
        }
      })

      return classPayloads.filter((item) => item.rows.length > 0)
    }

    const selectedId = targetClassId
    let rows = []
    if (selectedId === kelasSelected) {
      rows = sortJadwalRows(jadwal.map((item) => ({
        ...item,
        kelasId: selectedId
      })))
    } else {
      const { data, error } = await supabase
        .from('jadwal')
        .select('*')
        .eq('kelas_id', selectedId)
        .eq('tahun_ajaran', academicPeriod.tahunAjaran)
        .eq('semester', academicPeriod.semester)
        .order('hari')
        .order('jam_mulai')
      if (error) throw error
      rows = sortJadwalRows((data || []).map(normalizeScheduleRow))
    }

    const days = [...DEFAULT_SCHEDULE_DAYS]
    rows.forEach((row) => {
      const day = normalizeScheduleDay(row.hari)
      if (day && !days.includes(day)) days.push(day)
    })

    return [{
      classId: selectedId,
      className: resolveExportClassName(selectedId),
      rows,
      days,
      matrix: buildScheduleMatrix(rows, days)
    }]
  }

  const createExcelScheduleBuffer = async (classPayloads) => {
    const ExcelJS = await loadExcelJsBrowser()
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'EduSmart Admin'
    workbook.created = new Date()

    const usedSheetNames = new Set()
    const summarySheet = workbook.addWorksheet(buildSheetName('Ringkasan Export Jadwal', usedSheetNames))
    summarySheet.columns = [
      { header: 'No', key: 'no', width: 8 },
      { header: 'Kelas', key: 'kelas', width: 22 },
      { header: 'Jumlah Entri Jadwal', key: 'entries', width: 20 },
      { header: 'Jumlah Slot Waktu', key: 'slots', width: 18 }
    ]
    summarySheet.addRows(classPayloads.map((item, idx) => ({
      no: idx + 1,
      kelas: item.className,
      entries: item.rows.length,
      slots: item.matrix.length
    })))
    summarySheet.getRow(1).font = { bold: true }
    summarySheet.views = [{ state: 'frozen', ySplit: 1 }]

    const border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } }
    }

    classPayloads.forEach((payload) => {
      const days = payload.days || DEFAULT_SCHEDULE_DAYS
      const matrix = payload.matrix || []
      const sheet = workbook.addWorksheet(buildSheetName(`Jadwal ${payload.className}`, usedSheetNames))
      const lastCol = 2 + days.length

      sheet.mergeCells(1, 1, 2, 1)
      sheet.mergeCells(1, 2, 2, 2)
      sheet.mergeCells(1, 3, 1, lastCol)
      sheet.getCell(1, 1).value = 'JAM KE'
      sheet.getCell(1, 2).value = 'WAKTU'
      sheet.getCell(1, 3).value = 'HARI'

      days.forEach((day, idx) => {
        sheet.getCell(2, 3 + idx).value = day.toUpperCase()
      })

      for (let col = 1; col <= lastCol; col += 1) {
        sheet.getCell(1, col).border = border
        sheet.getCell(2, col).border = border
        sheet.getCell(1, col).alignment = { vertical: 'middle', horizontal: 'center' }
        sheet.getCell(2, col).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      }

      for (let row = 1; row <= 2; row += 1) {
        for (let col = 1; col <= 2; col += 1) {
          sheet.getCell(row, col).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF4CCCC' }
          }
          sheet.getCell(row, col).font = { bold: true, color: { argb: 'FF000000' } }
        }
      }

      for (let col = 3; col <= lastCol; col += 1) {
        sheet.getCell(1, col).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF00B0F0' }
        }
        sheet.getCell(1, col).font = { bold: true, color: { argb: 'FF000000' } }
        sheet.getCell(2, col).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFF00' }
        }
        sheet.getCell(2, col).font = { bold: true, color: { argb: 'FF000000' } }
      }

      if (!matrix.length) {
        sheet.mergeCells(3, 1, 3, lastCol)
        const cell = sheet.getCell(3, 1)
        cell.value = `Tidak ada jadwal untuk kelas ${payload.className}`
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
        cell.border = border
      } else {
        matrix.forEach((slot, idx) => {
          const rowIndex = idx + 3
          sheet.getCell(rowIndex, 1).value = slot.jamKe
          sheet.getCell(rowIndex, 2).value = slot.rangeLabel

          days.forEach((day, dayIdx) => {
            const cell = sheet.getCell(rowIndex, 3 + dayIdx)
            const entries = slot.cellEntries?.[day] || []
            cell.value = buildScheduleCellExcelValue(entries)
          })

          for (let col = 1; col <= lastCol; col += 1) {
            const cell = sheet.getCell(rowIndex, col)
            cell.border = border
            cell.alignment = {
              vertical: 'middle',
              horizontal: 'center',
              wrapText: col >= 3
            }
          }

          if (slot.isBreakRow) {
            for (let col = 1; col <= lastCol; col += 1) {
              sheet.getCell(rowIndex, col).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF92D050' }
              }
              sheet.getCell(rowIndex, col).font = { bold: true, italic: true }
            }
          }
        })
      }

      sheet.getColumn(1).width = 8
      sheet.getColumn(2).width = 14
      for (let col = 3; col <= lastCol; col += 1) {
        sheet.getColumn(col).width = 22
      }

      sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }]
      sheet.pageSetup = {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0
      }
    })

    return workbook.xlsx.writeBuffer()
  }

  const exportScheduleToPdf = async (payload) => {
    const jsPDF = await loadJsPdf()
    const autoTable = await loadAutoTable()
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
    const days = payload.days || DEFAULT_SCHEDULE_DAYS
    const matrix = payload.matrix || []

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text(`Jadwal Pelajaran - ${payload.className}`, 420, 30, { align: 'center' })
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(`Dicetak: ${new Date().toLocaleString('id-ID')}`, 40, 46)

    const head = [
      [
        { content: 'JAM KE', rowSpan: 2, styles: { fillColor: [244, 204, 204], textColor: 0 } },
        { content: 'WAKTU', rowSpan: 2, styles: { fillColor: [244, 204, 204], textColor: 0 } },
        { content: 'HARI', colSpan: days.length, styles: { fillColor: [0, 176, 240], textColor: 0 } }
      ],
      days.map((day) => ({ content: day.toUpperCase(), styles: { fillColor: [255, 255, 0], textColor: 0 } }))
    ]

    const body = matrix.map((slot) => ([
      String(slot.jamKe),
      slot.rangeLabel,
      ...days.map((day) => slot.cellText[day] || '')
    ]))

    if (!autoTable && typeof doc.autoTable !== 'function') {
      throw new Error('Plugin PDF table tidak tersedia.')
    }

    const tableConfig = {
      startY: 58,
      head,
      body,
      styles: {
        font: 'helvetica',
        fontSize: 8,
        halign: 'center',
        valign: 'middle',
        lineColor: [0, 0, 0],
        lineWidth: 0.2,
        overflow: 'linebreak',
        cellPadding: 3
      },
      didParseCell: (hook) => {
        if (hook.section === 'body' && matrix[hook.row.index]?.isBreakRow) {
          hook.cell.styles.fillColor = [146, 208, 80]
          hook.cell.styles.fontStyle = 'bolditalic'
        }
      }
    }

    if (autoTable) {
      autoTable(doc, tableConfig)
    } else {
      doc.autoTable(tableConfig)
    }

    doc.save(`jadwal-${classSlug(payload.className)}.pdf`)
  }

  const exportJadwal = async () => {
    try {
      setExportingJadwal(true)
      const targetClassId = exportClassId || kelasSelected
      if (!targetClassId) {
        pushToast('error', 'Pilih kelas terlebih dahulu.')
        return
      }

      if (targetClassId === '__all__' && exportFormat !== 'excel') {
        setExportFormat('excel')
        pushToast('info', 'Export semua kelas hanya tersedia dalam format Excel.')
        return
      }

      const payloads = await collectExportPayload()
      if (!payloads.length) {
        pushToast('error', 'Tidak ada data jadwal untuk diexport.')
        return
      }

      if (exportFormat === 'pdf') {
        await exportScheduleToPdf(payloads[0])
        pushToast('success', `Jadwal ${payloads[0].className} berhasil diexport ke PDF (landscape).`)
        return
      }

      const buffer = await createExcelScheduleBuffer(payloads)
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const fileName = targetClassId === '__all__'
        ? `jadwal-semua-kelas-${stamp}.xlsx`
        : `jadwal-${classSlug(payloads[0].className)}-${stamp}.xlsx`
      downloadBlob(
        new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        fileName
      )
      pushToast('success', `Jadwal berhasil diexport ke Excel (${payloads.length} sheet kelas).`)
    } catch (error) {
      console.error('Error exporting jadwal:', error)
      pushToast('error', error?.message || 'Gagal mengekspor jadwal.')
    } finally {
      setExportingJadwal(false)
    }
  }

  // Fungsi untuk mencetak jadwal
  const printJadwal = () => {
    window.print()
  }

  /* ============================ RENDER ============================ */
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-6">
      {/* Modal Password Akses Halaman */}
      <PasswordModal
        isOpen={passwordModalOpen && !isAuthorized}
        onClose={handlePasswordClose}
        onConfirm={handlePasswordConfirm}
        title="Akses Manajemen Kelas & Jadwal"
        loading={passwordLoading}
      />

      {/* Jika belum authorized: tampilkan layar kunci saja */}
      {!isAuthorized ? (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 w-full max-w-md">
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-3xl">🔒</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Halaman Terkunci</h1>
              <p className="text-gray-600 mt-2">
                Halaman ini memerlukan autentikasi admin. 
                Silakan konfirmasi password untuk melanjutkan.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setPasswordModalOpen(true)}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 text-sm font-medium transition-all duration-200 shadow-md flex items-center justify-center space-x-2"
            >
              <span>🔑</span>
              <span>Masukkan Password Admin</span>
            </button>
            
            <div className="mt-4 text-center">
              <p className="text-xs text-gray-500">
                Hanya user dengan role admin yang dapat mengakses
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* ================== KONTEN ASLI HALAMAN ================== */
        <div className="w-full space-y-8 px-4 sm:px-6 lg:px-8 pt-2">
          {/* Header */}
          <div className="page-title-card">
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
              <div className="flex items-center space-x-4">
                <div className="p-3 bg-blue-100 rounded-2xl">
                  <span className="text-2xl text-blue-600">🏫</span>
                </div>
                <div>
                  <h1 className="page-title-heading">Manajemen Kelas & Jadwal</h1>
                  <p className="page-title-description">
                    Kelola data kelas, jadwal pelajaran, dan struktur organisasi sekolah
                  </p>
                </div>
              </div>

              {/* Tab Navigation */}
              <div className="flex flex-wrap gap-2">
                {[
                  {
                    key: 'kelas',
                    label: 'Kelas & Jadwal',
                    icon: '📚',
                    activeClass: 'bg-blue-600 text-white border border-blue-600 shadow-sm',
                    idleClass: 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-blue-50 hover:text-blue-700'
                  },
                  {
                    key: 'struktur',
                    label: 'Struktur Sekolah',
                    icon: '🏢',
                    activeClass: 'bg-purple-600 text-white border border-purple-600 shadow-sm',
                    idleClass: 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-purple-50 hover:text-purple-700'
                  },
                  {
                    key: 'org',
                    label: 'Organisasi',
                    icon: '👥',
                    activeClass: 'bg-green-600 text-white border border-green-600 shadow-sm',
                    idleClass: 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-green-50 hover:text-green-700'
                  }
                ].map(({ key, label, icon, activeClass, idleClass }) => {
                  const active = tab === key
                  return (
                    <button
                      key={key}
                      className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center space-x-2 ${
                        active ? activeClass : idleClass
                      }`}
                      onPointerEnter={() => prefetchLazyTab(key)}
                      onFocus={() => prefetchLazyTab(key)}
                      onClick={() => {
                        prefetchLazyTab(key)
                        setTab(key)
                      }}
                    >
                      <span>{icon}</span>
                      <span>{label}</span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center space-x-2 bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                  onClick={openPromotionModal}
                >
                  <span>⬆️</span>
                  <span>Kenaikan Kelas</span>
                </button>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="space-y-6">
            {/* Loading Overlay */}
            {(loading || passwordLoading) && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
                <div className="bg-white rounded-2xl p-6 flex flex-col items-center space-y-4 shadow-2xl">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                  <div className="text-center">
                    <span className="text-gray-700 font-medium">Memproses data...</span>
                    <p className="text-sm text-gray-500 mt-1">Mohon tunggu sebentar</p>
                  </div>
                </div>
              </div>
            )}

            {/* ===================== TAB: KELAS & JADWAL ===================== */}
            {tab === 'kelas' && (
              <div className="space-y-6">
                <div className="bg-white rounded-2xl shadow-lg p-5 border border-blue-200">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <span className="p-2 bg-blue-100 rounded-lg">🎓</span>
                        <span>Periode Akademik Aktif</span>
                      </h2>
                      <p className="text-sm text-gray-600 mt-1">
                        Jadwal baru dan pengecekan konflik memakai periode ini agar data semester lain tetap tersimpan.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-[180px_140px_auto] gap-3 w-full lg:w-auto">
                      <select
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        value={periodForm.tahunAjaran}
                        onChange={(event) => setPeriodForm((prev) => ({ ...prev, tahunAjaran: event.target.value }))}
                      >
                        {generateAcademicYearOptions().map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}{opt.isCurrent ? ' (saat ini)' : ''}
                          </option>
                        ))}
                      </select>
                      <select
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        value={periodForm.semester}
                        onChange={(event) => setPeriodForm((prev) => ({ ...prev, semester: event.target.value }))}
                      >
                        <option value="Ganjil">Ganjil</option>
                        <option value="Genap">Genap</option>
                      </select>
                      <button
                        type="button"
                        onClick={simpanPeriodeAktif}
                        disabled={savingPeriod}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 text-sm font-medium"
                      >
                        {savingPeriod ? 'Menyimpan...' : 'Simpan Periode'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                      Saat ini: {academicPeriod.tahunAjaran} - {academicPeriod.semester}
                    </span>
                    <span className="px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                      Periode berikutnya: {nextAcademicPeriod.tahunAjaran} - {nextAcademicPeriod.semester}
                    </span>
                    {academicPeriod.rangeLabel && (
                      <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Bulan semester: {academicPeriod.rangeLabel}
                      </span>
                    )}
                  </div>
                </div>

                {/* Statistik Ringkas */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div className="bg-white rounded-xl p-4 shadow border border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Total Kelas</p>
                        <p className="text-2xl font-bold text-gray-900">{kelas.length}</p>
                      </div>
                      <div className="p-3 bg-blue-100 rounded-lg">
                        <span className="text-xl">🏫</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-4 shadow border border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Total Guru</p>
                        <p className="text-2xl font-bold text-gray-900">{guruList.length}</p>
                      </div>
                      <div className="p-3 bg-green-100 rounded-lg">
                        <span className="text-xl">👨‍🏫</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-4 shadow border border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Total Mapel</p>
                        <p className="text-2xl font-bold text-gray-900">{mapelList.length}</p>
                      </div>
                      <div className="p-3 bg-purple-100 rounded-lg">
                        <span className="text-xl">📚</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-4 shadow border border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Total Jadwal</p>
                        <p className="text-2xl font-bold text-gray-900">{jadwal.length}</p>
                      </div>
                      <div className="p-3 bg-orange-100 rounded-lg">
                        <span className="text-xl">📅</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-4 shadow border border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Semester</p>
                        <p className="text-lg font-bold text-gray-900">{academicPeriod.semester}</p>
                        <p className="text-xs text-gray-500">{academicPeriod.tahunAjaran}</p>
                      </div>
                      <div className="p-3 bg-indigo-100 rounded-lg">
                        <span className="text-xl">🗓️</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Kelas List Card */}
                <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
                        <span className="p-2 bg-blue-100 rounded-lg">📋</span>
                        <span>Daftar Kelas</span>
                      </h2>
                      <p className="text-gray-600 text-sm mt-1">
                        Pilih kelas untuk melihat dan mengelola jadwal
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex items-center space-x-2">
                        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                          Filter Grade:
                        </label>
                        <select
                          className="block w-full sm:w-48 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                          value={filterGrade}
                          onChange={e => {
                            setFilterGrade(e.target.value)
                            const first = kelas.find(k => k.grade === e.target.value)
                            if (first) setKelasSelected(first.id)
                          }}
                        >
                          <option value="">Semua Grade</option>
                          {GRADE_OPTS.map(g => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                      </div>

                      <div className="px-3 py-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg">
                        Export jadwal tersedia di panel "Jadwal Pelajaran".
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {kelasByGrade.map(k => (
                      <div key={k.id} className="relative group">
                        <button
                          className={`px-5 py-3 rounded-xl border-2 transition-all duration-200 font-semibold min-w-[120px] flex flex-col items-center justify-center ${
                            kelasSelected === k.id
                              ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white border-blue-600 shadow-lg transform scale-105'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-600 hover:shadow-md'
                          }`}
                          onClick={() => setKelasSelected(k.id)}
                          title={k.nama || k.id}
                        >
                          <span className="block text-lg font-bold">{(k.nama || k.id).toUpperCase()}</span>
                          <span className="text-xs opacity-75 mt-1">Grade {k.grade}</span>
                          <span className="text-[11px] opacity-75">Angkatan {k.angkatan || '-'}</span>
                        </button>
                        
                        {/* Delete button (only visible on hover) */}
                        <button
                          className="absolute -top-2 -right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-red-600 shadow-lg z-10"
                          onClick={(e) => {
                            e.stopPropagation()
                            hapusKelas(k.id)
                          }}
                          title="Hapus kelas"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    
                    {/* Empty State */}
                    {!kelasByGrade.length && (
                      <div className="text-center py-12 text-gray-500 w-full">
                        <div className="w-20 h-20 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                          <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0H4" />
                          </svg>
                        </div>
                        <p className="text-lg font-medium">Belum ada kelas</p>
                        <p className="text-sm mt-1">Tambahkan kelas baru untuk memulai</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Grid untuk Form Kelas dan Mata Pelajaran */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Form Buat Kelas */}
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                      <span className="p-2 bg-blue-100 rounded-lg">✨</span>
                      <span>Buat Kelas Baru</span>
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Grade <span className="text-red-500">*</span>
                        </label>
                        <select
                          className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                          value={newGrade}
                          onChange={e => setNewGrade(e.target.value)}
                        >
                          <option value="">Pilih grade</option>
                          {GRADE_OPTS.map(g => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Nama / Sufiks Kelas <span className="text-red-500">*</span>
                        </label>
                        <input
                          className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm text-gray-900"
                          placeholder="Contoh: A, IPA 1, atau A IPS"
                          value={newSuffix}
                          onChange={e => setNewSuffix(String(e.target.value || '').toUpperCase())}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Contoh hasil: VII A, X IPA 1, dll.
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Angkatan
                        </label>
                        <input
                          className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm text-gray-900"
                          placeholder={newGrade ? inferCohortYear(newGrade, academicPeriod.startYear) : 'Contoh: 2026'}
                          value={newAngkatan}
                          onChange={e => setNewAngkatan(String(e.target.value || '').replace(/[^\d]/g, '').slice(0, 4))}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Digunakan untuk menandai cohort/angkatan siswa dan kelas.
                        </p>
                      </div>
                      <button
                        className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 font-medium shadow-md flex items-center justify-center space-x-2 disabled:opacity-50"
                        onClick={tambahKelas}
                        disabled={!newGrade || !newSuffix.trim()}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        <span>Tambah Kelas Baru</span>
                      </button>
                    </div>
                  </div>

                  {/* Mata Pelajaran */}
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                      <span className="p-2 bg-purple-100 rounded-lg">📖</span>
                      <span>Kelola Mata Pelajaran</span>
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Nama Mata Pelajaran Baru <span className="text-red-500">*</span>
                        </label>
                        <div className="flex space-x-3">
                          <input
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm text-gray-900"
                            placeholder="Contoh: Matematika Wajib"
                            value={newMapel}
                            onChange={e => setNewMapel(normalizeMapelInput(e.target.value))}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                tambahMapel()
                              }
                            }}
                          />
                          <button
                            className="bg-gradient-to-r from-purple-600 to-purple-700 text-white px-5 py-2 rounded-lg hover:from-purple-700 hover:to-purple-800 focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-all duration-200 font-medium shadow-md flex items-center space-x-2"
                            onClick={tambahMapel}
                            disabled={!newMapel.trim()}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                            <span>Tambah</span>
                          </button>
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <h4 className="text-sm font-medium text-gray-700 mb-3">Daftar Mata Pelajaran</h4>
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                          {mapelList.map(m => (
                            <div
                              key={m.id}
                              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors duration-150 group"
                            >
                              <div className="flex items-center space-x-3">
                                <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                                  <span className="text-purple-600">📚</span>
                                </div>
                                <span className="font-medium text-gray-800">{m.nama}</span>
                              </div>
                              <button
                                className="text-red-500 hover:text-red-700 p-2 rounded-lg transition-all duration-200 hover:bg-red-50 opacity-0 group-hover:opacity-100"
                                onClick={() => hapusMapel(m)}
                                title="Hapus mata pelajaran"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          ))}
                          {!mapelList.length && (
                            <div className="text-center py-8 text-gray-500">
                              <div className="w-12 h-12 mx-auto mb-3 bg-gray-100 rounded-full flex items-center justify-center">
                                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                </svg>
                              </div>
                              <p>Belum ada mata pelajaran</p>
                              <p className="text-xs mt-1">Tambahkan mata pelajaran untuk digunakan di jadwal</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Struktur Kelas */}
                {selObj && kelasSelected && (
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                      <span className="p-2 bg-green-100 rounded-lg">👨‍🏫</span>
                      <span>Struktur Kelas • <span className="font-bold">{(selObj?.nama || kelasSelected).toUpperCase()}</span></span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Wali Kelas</label>
                          <select
                            className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                            value={waliGuruId}
                            onChange={e => setWaliGuruId(e.target.value)}
                          >
                            <option value="">Pilih wali kelas</option>
                            {guruList.map(g => (
                              <option key={g.id} value={g.id}>{g.label || g.name}</option>
                            ))}
                          </select>
                          {waliGuruId && (
                            <p className="text-xs text-green-600 mt-1">
                              {guruNameById(waliGuruId)}
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Ketua Kelas</label>
                          <select
                            className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                            value={ketuaUid}
                            onChange={e => setKetuaUid(e.target.value)}
                          >
                            <option value="">Pilih ketua kelas</option>
                            {siswaDiKelasTerpilih.map(s => (
                              <option key={s.uid} value={s.uid}>
                                {s.nama} {s.kelas ? `(${s.kelas})` : ''}
                              </option>
                            ))}
                          </select>
                          {ketuaUid && (
                            <p className="text-xs text-green-600 mt-1">
                              {siswaNameByUid(ketuaUid)}
                            </p>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex flex-col justify-end space-y-3">
                        <div className="text-sm text-gray-600 bg-gray-50 p-4 rounded-lg">
                          <p className="font-medium mb-2">Info:</p>
                          <ul className="space-y-1 text-xs">
                            <li>• Wali kelas bertanggung jawab penuh terhadap kelas</li>
                            <li>• Ketua kelas mewakili siswa dalam kelas</li>
                            <li>• Data akan tersimpan secara otomatis</li>
                          </ul>
                        </div>
                        
                        <div className="flex space-x-3 pt-2">
                          <button
                            className="flex-1 bg-gradient-to-r from-green-600 to-green-700 text-white py-3 px-4 rounded-lg hover:from-green-700 hover:to-green-800 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-200 font-medium shadow-md flex items-center justify-center space-x-2"
                            onClick={simpanStrukturKelas}
                            disabled={loading}
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>Simpan Struktur</span>
                          </button>
                          <button
                            className="px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-all duration-200 font-medium flex items-center space-x-2"
                            onClick={kosongkanStrukturKelas}
                            disabled={loading}
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            <span>Reset</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Jadwal Section */}
                {kelasSelected && (
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6">
                      <div>
                        <h3 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
                          <span className="p-2 bg-orange-100 rounded-lg">📅</span>
                          <span>Jadwal Pelajaran • <span className="font-bold">{(selObj?.nama || kelasSelected).toUpperCase()}</span></span>
                        </h3>
                        <p className="text-gray-600 text-sm mt-1">
                          Kelola jadwal pelajaran untuk kelas ini
                        </p>
                        <p className="text-xs text-blue-700 mt-1">
                          Periode: {academicPeriod.tahunAjaran} - Semester {academicPeriod.semester}
                        </p>
                      </div>
                      
                      <div className="mt-4 lg:mt-0 w-full lg:w-auto">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <select
                            value={exportClassId || kelasSelected || ''}
                            onChange={(event) => setExportClassId(event.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                          >
                            {kelas.map((item) => (
                              <option key={item.id} value={item.id}>
                                {String(item.nama || item.id).toUpperCase()}
                              </option>
                            ))}
                            <option value="__all__">SEMUA KELAS</option>
                          </select>

                          <select
                            value={exportFormat}
                            onChange={(event) => setExportFormat(event.target.value)}
                            disabled={(exportClassId || kelasSelected) === '__all__'}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 disabled:bg-gray-100 disabled:text-gray-400"
                          >
                            <option value="excel">Excel (.xlsx)</option>
                            <option value="pdf">PDF Landscape (.pdf)</option>
                          </select>

                          <button
                            onClick={exportJadwal}
                            disabled={exportingJadwal}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                          >
                            <span>📥</span>
                            <span>{exportingJadwal ? 'Mengekspor...' : 'Ekspor'}</span>
                          </button>
                        </div>
                        {(exportClassId || kelasSelected) === '__all__' && (
                          <p className="text-xs text-amber-700 mt-2">
                            Mode "Semua Kelas" otomatis memakai Excel agar data tidak terpotong.
                          </p>
                        )}
                        <div className="flex justify-end mt-2">
                          <button
                            onClick={printJadwal}
                            className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm flex items-center space-x-2"
                          >
                            <span>🖨️</span>
                            <span>Cetak</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Filter Hari */}
                    <div className="mb-6 flex flex-col sm:flex-row sm:items-end space-y-4 sm:space-y-0 sm:space-x-4 bg-blue-50 p-4 rounded-xl border border-blue-200">
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-blue-800 mb-1">Filter Hari</label>
                        <select
                          className="block w-full sm:w-48 px-3 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                          value={filterHari}
                          onChange={e => setFilterHari(e.target.value)}
                        >
                          <option value="">Semua Hari</option>
                          {HARI_OPTS.map(h => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      {filterHari && (
                        <div className="flex items-end">
                          <button
                            className="px-4 py-2 text-sm text-blue-700 hover:text-blue-900 border border-blue-300 rounded-lg hover:bg-blue-100 transition-colors duration-200 font-medium flex items-center space-x-2"
                            onClick={() => setFilterHari('')}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            <span>Reset Filter</span>
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mb-6 rounded-xl border border-blue-200 overflow-hidden">
                      <div className="px-4 py-3 bg-blue-50 border-b border-blue-200">
                        <h4 className="font-semibold text-blue-900">Preview Jadwal Format Cetak / Export</h4>
                        <p className="text-xs text-blue-700 mt-1">
                          Tata letak ini mengikuti format tabel untuk PDF landscape dan Excel.
                        </p>
                      </div>
                      <div className="overflow-auto">
                        <table className="min-w-[920px] w-full border-collapse text-sm">
                          <thead>
                            <tr>
                              <th
                                rowSpan={2}
                                className="border border-gray-900 bg-rose-100 px-2 py-2 text-center font-semibold text-gray-900"
                              >
                                JAM KE
                              </th>
                              <th
                                rowSpan={2}
                                className="border border-gray-900 bg-rose-100 px-2 py-2 text-center font-semibold text-gray-900"
                              >
                                WAKTU
                              </th>
                              <th
                                colSpan={exportDays.length}
                                className="border border-gray-900 bg-sky-500 px-2 py-2 text-center font-semibold text-gray-900"
                              >
                                HARI
                              </th>
                            </tr>
                            <tr>
                              {exportDays.map((day) => (
                                <th
                                  key={day}
                                  className="border border-gray-900 bg-yellow-300 px-2 py-2 text-center font-semibold text-gray-900"
                                >
                                  {day.toUpperCase()}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {jadwalMatrix.length > 0 ? (
                              jadwalMatrix.map((slot) => (
                                <tr key={slot.key} className={slot.isBreakRow ? 'bg-lime-300' : 'bg-white'}>
                                  <td className="border border-gray-900 px-2 py-2 text-center font-semibold">{slot.jamKe}</td>
                                  <td className="border border-gray-900 px-2 py-2 text-center font-medium whitespace-nowrap">
                                    {slot.rangeLabel}
                                  </td>
                                  {exportDays.map((day) => (
                                    <td
                                      key={`${slot.key}-${day}`}
                                      className="border border-gray-900 px-2 py-2 text-center align-middle"
                                    >
                                      {(slot.cellEntries?.[day] || []).length > 0 ? (
                                        <div className="space-y-1">
                                          {(slot.cellEntries[day] || []).map((entry, idx) => (
                                            <div
                                              key={`${slot.key}-${day}-${idx}-${entry.mapel || entry.guruNama || 'jadwal'}`}
                                              className={idx > 0 ? 'border-t border-gray-300 pt-1' : ''}
                                            >
                                              <p className="font-medium text-gray-900 leading-tight">
                                                {entry.mapel || '-'}
                                              </p>
                                              {entry.guruNama ? (
                                                <p className="text-[11px] text-gray-600 leading-tight mt-0.5">
                                                  {entry.guruNama}
                                                </p>
                                              ) : null}
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        '-'
                                      )}
                                    </td>
                                  ))}
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td
                                  colSpan={2 + exportDays.length}
                                  className="border border-gray-900 px-3 py-6 text-center text-gray-500"
                                >
                                  Belum ada jadwal untuk kelas ini.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Form Tambah Jadwal */}
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-5 mb-6 border border-blue-200">
                      <h4 className="font-semibold text-blue-900 mb-4 flex items-center space-x-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        <span>Tambah Jadwal Baru</span>
                      </h4>
                      <form
                        onSubmit={tambahJadwal}
                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4"
                      >
                        <div>
                          <label className="block text-xs font-medium text-blue-800 mb-1">
                            Hari <span className="text-red-500">*</span>
                          </label>
                          <select
                            className="block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                            value={form.hari}
                            onChange={e => setForm(f => ({ ...f, hari: e.target.value }))}
                            required
                          >
                            <option value="">Pilih hari</option>
                            {HARI_OPTS.map(h => (
                              <option key={h} value={h}>{h}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-blue-800 mb-1">
                            Mapel <span className="text-red-500">*</span>
                          </label>
                          <select
                            className="block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                            value={form.mapel}
                            onChange={e => setForm(f => ({ ...f, mapel: e.target.value }))}
                            required
                          >
                            <option value="">Pilih mapel</option>
                            {mapelList.map(m => (
                              <option key={m.id} value={m.nama}>{m.nama}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-blue-800 mb-1">Guru Pengajar</label>
                          <select
                            className="block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                            value={form.guruId}
                            onChange={e => setForm(f => ({ ...f, guruId: e.target.value }))}
                          >
                            <option value="">Pilih guru (opsional)</option>
                            {guruList.map(g => (
                              <option key={g.id} value={g.id}>{g.label || g.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-blue-800 mb-1">
                            Jam Mulai <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="time"
                            className="block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                            value={form.jamMulai}
                            onChange={e => setForm(f => ({ ...f, jamMulai: e.target.value }))}
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-blue-800 mb-1">
                            Jam Selesai <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="time"
                            className="block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                            value={form.jamSelesai}
                            onChange={e => setForm(f => ({ ...f, jamSelesai: e.target.value }))}
                            required
                          />
                        </div>
                        <div className="flex items-end">
                          <button
                            type="submit"
                            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-2.5 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 text-sm font-medium shadow-md flex items-center justify-center space-x-2 disabled:opacity-50"
                            disabled={loading || !form.hari || !form.mapel || !form.jamMulai || !form.jamSelesai}
                          >
                            {loading ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                <span>Menambah...</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                </svg>
                                <span>Tambah</span>
                              </>
                            )}
                          </button>
                        </div>
                      </form>
                    </div>

                    {/* Daftar Jadwal */}
                    <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Hari
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Jam
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Mapel
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Guru
                            </th>
                            <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Aksi
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {jadwalToShow.map(j => (
                            <tr key={j.id} className="hover:bg-blue-50 transition-colors duration-150 group">
                              {editId === j.id ? (
                                <>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <select
                                      className="block w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                                      value={editData.hari}
                                      onChange={e => setEditData(d => ({ ...d, hari: e.target.value }))}
                                    >
                                      {HARI_OPTS.map(h => (
                                        <option key={h} value={h}>{h}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center space-x-2">
                                      <input
                                        type="time"
                                        className="block w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                                        value={editData.jamMulai}
                                        onChange={e => setEditData(d => ({ ...d, jamMulai: e.target.value }))}
                                      />
                                      <span className="text-gray-400">-</span>
                                      <input
                                        type="time"
                                        className="block w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                                        value={editData.jamSelesai}
                                        onChange={e => setEditData(d => ({ ...d, jamSelesai: e.target.value }))}
                                      />
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <select
                                      className="block w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                                      value={editData.mapel}
                                      onChange={e => setEditData(d => ({ ...d, mapel: e.target.value }))}
                                    >
                                      <option value="">Pilih mapel</option>
                                      {mapelList.map(m => (
                                        <option key={m.id} value={m.nama}>{m.nama}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <select
                                      className="block w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                                      value={editData.guruId || ''}
                                      onChange={e => setEditData(d => ({ ...d, guruId: e.target.value || null }))}
                                    >
                                      <option value="">Pilih guru</option>
                                      {guruList.map(g => (
                                        <option key={g.id} value={g.id}>{g.label || g.name}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                                    <button
                                      className="text-green-600 hover:text-green-800 font-medium text-sm px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors duration-200 flex items-center space-x-1"
                                      onClick={saveEdit}
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                      <span>Simpan</span>
                                    </button>
                                    <button
                                      className="text-gray-600 hover:text-gray-800 font-medium text-sm px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors duration-200 flex items-center space-x-1"
                                      onClick={cancelEdit}
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                      <span>Batal</span>
                                    </button>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span className="font-medium text-gray-900 bg-blue-100 px-3 py-1.5 rounded-full text-xs inline-flex items-center">
                                      <span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
                                      {j.hari}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex flex-col">
                                      <span className="text-gray-900 font-mono font-bold">
                                        {j.jamMulai} - {j.jamSelesai}
                                      </span>
                                      <span className="text-xs text-gray-500">
                                        {toMinutes(j.jamSelesai) - toMinutes(j.jamMulai)} menit
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center space-x-2">
                                      <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                                        <span className="text-purple-600 text-xs">📚</span>
                                      </div>
                                      <span className="font-semibold text-gray-900">{j.mapel}</span>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    {j.guruNama ? (
                                      <div className="flex items-center space-x-2">
                                        <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                                          <span className="text-green-600 text-xs">👨‍🏫</span>
                                        </div>
                                        <span className="text-gray-700">{j.guruNama}</span>
                                      </div>
                                    ) : (
                                      <span className="text-gray-400 italic">Belum ada guru</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                                    <div className="flex justify-end space-x-2">
                                      <button
                                        className="text-blue-600 hover:text-blue-800 font-medium text-sm px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors duration-200 flex items-center space-x-1 opacity-0 group-hover:opacity-100"
                                        onClick={() => startEdit(j)}
                                        title="Edit jadwal"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                        <span>Edit</span>
                                      </button>
                                      <button
                                        className="text-red-600 hover:text-red-800 font-medium text-sm px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors duration-200 flex items-center space-x-1 opacity-0 group-hover:opacity-100"
                                        onClick={() => hapusJadwal(j.id)}
                                        title="Hapus jadwal"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                        <span>Hapus</span>
                                      </button>
                                    </div>
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                          {!jadwalToShow.length && (
                            <tr>
                              <td colSpan="5" className="px-6 py-12 text-center text-gray-500">
                                <div className="w-20 h-20 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                                  <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                </div>
                                <p className="text-lg font-medium text-gray-600">
                                  {filterHari
                                    ? `Tidak ada jadwal untuk hari ${filterHari}`
                                    : 'Belum ada jadwal untuk kelas ini.'}
                                </p>
                                <p className="text-sm mt-1">Tambahkan jadwal baru untuk memulai</p>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    
                    {/* Summary */}
                    {jadwalToShow.length > 0 && (
                      <div className="mt-4 text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                        <p>
                          <span className="font-medium">Total:</span> {jadwalToShow.length} jadwal 
                          {filterHari && ` untuk hari ${filterHari}`}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ===================== TAB: STRUKTUR SEKOLAH ===================== */}
            {tab === 'struktur' && (
              <React.Suspense fallback={<TabContentFallback label="Memuat struktur sekolah..." />}>
                <StrukturSekolahTab guruList={guruList} pushToast={pushToast} />
              </React.Suspense>
            )}

            {/* ===================== TAB: ORGANISASI ===================== */}
            {tab === 'org' && (
              <React.Suspense fallback={<TabContentFallback label="Memuat organisasi..." />}>
                <OrganisasiTab guruList={guruList} siswaList={siswaList} pushToast={pushToast} />
              </React.Suspense>
            )}

            {promotionModalOpen && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                  <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <span className="p-2 bg-indigo-100 text-indigo-700 rounded-lg">⬆️</span>
                        <span>Kenaikan Kelas</span>
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Periode aktif {academicPeriod.tahunAjaran} - {academicPeriod.semester}. Data tugas, quiz, nilai, dan absensi lama tidak dihapus.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                      onClick={closePromotionModal}
                      disabled={promotionLoading}
                    >
                      Tutup
                    </button>
                  </div>

                  <div className="p-6 space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        className={`px-4 py-3 rounded-lg border text-sm font-medium ${promotionMode === 'kelas' ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-300 text-gray-700'}`}
                        onClick={() => setPromotionMode('kelas')}
                      >
                        Berdasarkan Kelas
                      </button>
                      <button
                        type="button"
                        className={`px-4 py-3 rounded-lg border text-sm font-medium ${promotionMode === 'selected' ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-300 text-gray-700'}`}
                        onClick={() => setPromotionMode('selected')}
                      >
                        Pilih Siswa Manual ({promotionSelectedIds.length})
                      </button>
                    </div>

                    {promotionMode === 'kelas' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Kelas Asal</label>
                          <select
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
                            value={promotionFromKelas}
                            onChange={(event) => setPromotionFromKelas(event.target.value)}
                          >
                            <option value="">Pilih kelas asal</option>
                            {kelasOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Tujuan</label>
                          <select
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
                            value={promotionToKelas}
                            onChange={(event) => setPromotionToKelas(event.target.value)}
                          >
                            <option value="">Pilih tujuan</option>
                            {kelasOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                            <option value={PROMO_ALUMNI}>Alumni / Lulus</option>
                            <option value={PROMO_MUTASI}>Mutasi / Pindah Sekolah</option>
                          </select>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Filter Tingkatan</label>
                            <select
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
                              value={promotionFilterGrade}
                              onChange={(event) => {
                                setPromotionFilterGrade(event.target.value)
                                setPromotionFilterKelas('')
                              }}
                            >
                              <option value="">Semua tingkatan</option>
                              {gradeLabelsForPromotion.map((grade) => (
                                <option key={grade} value={grade}>{grade}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Filter Kelas</label>
                            <select
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
                              value={promotionFilterKelas}
                              onChange={(event) => setPromotionFilterKelas(event.target.value)}
                            >
                              <option value="">Semua kelas</option>
                              {kelasOptions
                                .filter((option) => !promotionFilterGrade || option.grade === promotionFilterGrade)
                                .map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                          </div>
                        </div>

                        <div className="rounded-xl border border-gray-200 overflow-hidden">
                          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-3">
                            <p className="text-xs text-gray-600">
                              Siswa terlihat: <span className="font-semibold">{promotionCandidateSiswa.length}</span>
                              {' '}• Dipilih: <span className="font-semibold">{promotionSelectedIds.length}</span>
                            </p>
                            <button
                              type="button"
                              className="text-xs text-indigo-600 hover:underline disabled:text-gray-400"
                              onClick={togglePromotionSelectAllVisible}
                              disabled={!promotionCandidateSiswa.length}
                            >
                              {promotionCandidateSiswa.length > 0 && promotionCandidateSiswa.every((siswa) => promotionSelectedIds.includes(siswa.uid))
                                ? 'Hapus pilih semua'
                                : 'Pilih semua terlihat'}
                            </button>
                          </div>
                          <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
                            {promotionCandidateSiswa.length ? (
                              promotionCandidateSiswa.map((siswa) => (
                                <label key={siswa.uid} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                                    checked={promotionSelectedIds.includes(siswa.uid)}
                                    onChange={() => togglePromotionSelect(siswa.uid)}
                                  />
                                  <span className="flex-1 min-w-0">
                                    <span className="block text-sm font-medium text-gray-900 truncate">{siswa.nama}</span>
                                    <span className="block text-xs text-gray-500 truncate">
                                      {getKelasName(siswa.kelas)} • Angkatan {siswa.angkatan || '-'} • {siswa.email}
                                    </span>
                                  </span>
                                </label>
                              ))
                            ) : (
                              <div className="px-4 py-8 text-center text-sm text-gray-500">
                                Tidak ada siswa aktif yang cocok dengan filter.
                              </div>
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Tujuan</label>
                          <select
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
                            value={promotionToKelas}
                            onChange={(event) => setPromotionToKelas(event.target.value)}
                          >
                            <option value="">Pilih tujuan</option>
                            {kelasOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                            <option value={PROMO_ALUMNI}>Alumni / Lulus</option>
                            <option value={PROMO_MUTASI}>Mutasi / Pindah Sekolah</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {(promotionToKelas === PROMO_ALUMNI || promotionToKelas === PROMO_MUTASI) && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 space-y-3">
                        {promotionToKelas === PROMO_ALUMNI && (
                          <div>
                            <label className="block text-sm font-medium text-yellow-900 mb-1">Tahun Lulus</label>
                            <input
                              type="number"
                              min="2000"
                              max="2100"
                              className="w-full px-3 py-2 border border-yellow-300 rounded-lg bg-white focus:ring-2 focus:ring-yellow-500"
                              value={promotionAlumniYear}
                              onChange={(event) => setPromotionAlumniYear(event.target.value)}
                            />
                          </div>
                        )}
                        <div>
                          <label className="block text-sm font-medium text-yellow-900 mb-1">Alasan / Catatan</label>
                          <textarea
                            className="w-full px-3 py-2 border border-yellow-300 rounded-lg bg-white focus:ring-2 focus:ring-yellow-500 resize-none"
                            rows={3}
                            value={promotionExitReason}
                            onChange={(event) => setPromotionExitReason(event.target.value)}
                            placeholder={promotionToKelas === PROMO_ALUMNI ? 'Contoh: Lulus sesuai keputusan sekolah.' : 'Contoh: Mutasi mengikuti perpindahan orang tua.'}
                          />
                        </div>
                      </div>
                    )}

                    <label className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 text-indigo-600 border-gray-300 rounded"
                        checked={promotionAdvancePeriod}
                        onChange={(event) => setPromotionAdvancePeriod(event.target.checked)}
                      />
                      <span>
                        <span className="block text-sm font-semibold text-indigo-900">
                          Setelah proses, aktifkan periode berikutnya
                        </span>
                        <span className="block text-xs text-indigo-700 mt-1">
                          {nextAcademicPeriod.tahunAjaran} - {nextAcademicPeriod.semester}. Aktifkan ini saat kenaikan kelas akhir tahun benar-benar selesai.
                        </span>
                      </span>
                    </label>
                  </div>

                  <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                    <button
                      type="button"
                      className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                      onClick={closePromotionModal}
                      disabled={promotionLoading}
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
                      onClick={handlePromotion}
                      disabled={
                        promotionLoading ||
                        !promotionToKelas ||
                        (promotionMode === 'kelas' && !promotionFromKelas) ||
                        (promotionMode === 'selected' && !promotionSelectedIds.length) ||
                        ([PROMO_ALUMNI, PROMO_MUTASI].includes(promotionToKelas) && !promotionExitReason.trim())
                      }
                    >
                      {promotionLoading ? 'Memproses...' : 'Jalankan Kenaikan'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
