import React, { useEffect, useState, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { startTransition } from 'react'
import { supabase, apiFetch } from '../../lib/supabase'
import { queryClient, queryKeys } from '../../lib/queryClient'
import { useUIStore } from '../../store/useUIStore'
import PasswordInput from '../../components/PasswordInput'
import AcademicPeriodArchiveFilter from '../../components/AcademicPeriodArchiveFilter'
import { Trash2 } from 'lucide-react'
import { verifyCurrentUserPassword as verifyPassword } from '../../services/authService'
import useActiveAcademicPeriod from '../../hooks/useActiveAcademicPeriod'
import { loadExcelJsBrowser } from '../../utils/excelBrowser'
import {
  SCHEDULE_SCOPE_YEAR,
  doScheduleScopesOverlap,
  filterSchedulesForSemester,
  normalizeScheduleScope,
  scheduleScopeLabel,
  scheduleScopeToSemester
} from '../../utils/schedulePeriodScope'
import {
  getNextAcademicPeriod,
  inferCohortYear,
  normalizeAcademicYear,
  normalizeSemester,
  resolveAcademicPeriod,
  semesterRangeFields,
} from '../../utils/academicPeriod'
import {
  HARI_OPTS,
  GRADE_OPTS,
  GRADE_ORDER,
  FORBIDDEN,
  DEFAULT_SCHEDULE_DAYS,
  loadJsPdf,
  loadAutoTable,
  slug,
  toMinutes,
  toTimeHHMM,
  toTimeLabel,
  toRangeLabel,
  normalizeMapelInput,
  normalizeMapelName,
  normalizeScheduleDay,
  classSlug,
  buildSheetName,
  buildScheduleCellExcelValue,
  buildScheduleMatrix,
  timesOverlap,
  parseGrade,
  stripGradePrefix,
  makeClassName,
  normalizeClassSuffixInput,
} from '../../features/classes/utils/classUtils'
import SchedulePreviewTable from '../../features/classes/components/SchedulePreviewTable'

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
    if (!isOpen) return
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

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

/* quick helpers */
const confirmDelete = (msg = 'Yakin mau dihapus?') => window.confirm(msg)

const mapTeacherOptions = (rows = []) => (rows || []).map((user) => {
  const name = user.nama || user.email || user.id
  return {
    id: user.id,
    name,
    label: name + (user.email ? ` (${user.email})` : '')
  }
})

const mapClassRows = (rows = []) => {
  const mapped = (rows || []).map((kelas) => ({
    id: kelas.id,
    nama: kelas.nama || kelas.id,
    grade: kelas.grade || parseGrade(kelas.id),
    suffix: kelas.suffix || stripGradePrefix(kelas.nama || kelas.id),
    angkatan: kelas.angkatan || '',
    tahunAjaran: kelas.tahun_ajaran || '',
    semester: kelas.semester || '',
    isActive: kelas.is_active !== false,
    ...kelas
  }))

  mapped.sort((a, b) => {
    const ag = GRADE_ORDER[a.grade] ?? 999
    const bg = GRADE_ORDER[b.grade] ?? 999
    if (ag !== bg) return ag - bg
    return (a.suffix || '').localeCompare(b.suffix || '', 'id')
  })

  return mapped
}

const mapStudentRows = (rows = []) => (rows || []).map((user) => ({
  uid: user.id,
  nama: user.nama || user.email || user.id,
  email: user.email || '',
  kelas: user.kelas || '',
  status: user.status || 'active',
  angkatan: user.angkatan || '',
  classHistory: Array.isArray(user.class_history) ? user.class_history : []
}))

const formatStudentClassHistory = (history = []) => {
  const rows = (history || [])
    .filter((item) => item?.class_id || item?.class_name || item?.tahun_ajaran)
    .slice(0, 4)

  if (!rows.length) return 'Riwayat awal belum tercatat'

  return rows
    .map((item) => {
      const className = String(item.class_name || item.class_id || '-').toUpperCase()
      const period = [item.tahun_ajaran, item.semester ? `Smt ${item.semester}` : '']
        .filter(Boolean)
        .join(' ')
      const cohort = item.angkatan ? `angkatan masuk ${item.angkatan}` : ''

      return [className, period, cohort].filter(Boolean).join(' / ')
    })
    .join(' -> ')
}

const mapScheduleRows = (rows = [], period = {}) => {
  const mapped = (rows || []).map((row) => ({
    id: row.id,
    hari: row.hari,
    mapel: normalizeMapelName(row.mapel),
    guruId: row.guru_id,
    guruNama: row.guru_nama || '',
    jamMulai: toTimeHHMM(row.jam_mulai),
    jamSelesai: toTimeHHMM(row.jam_selesai),
    tahunAjaran: row.tahun_ajaran || period.tahunAjaran,
    semester: row.semester || period.semester,
    periodeBerlaku: normalizeScheduleScope(row.periode_berlaku)
  }))

  mapped.sort((a, b) => {
    const ai = HARI_OPTS.indexOf(a.hari)
    const bi = HARI_OPTS.indexOf(b.hari)
    if (ai !== bi) return ai - bi
    return toMinutes(a.jamMulai) - toMinutes(b.jamMulai)
  })

  return mapped
}

const mapSubjectRows = (rows = []) => (rows || []).map((item) => ({
  ...item,
  id: item.id,
  nama: normalizeMapelName(item.nama || item.id)
}))

const buildStudentDetailKey = (classId = '') => `${classId}|all`

const buildScheduleDetailKey = (classId = '', period = {}) => (
  `${classId}|${period.tahunAjaran || ''}|${period.semester || ''}`
)

/* ===== Component Utama: AKelas (Terkunci Password) ===== */
export default function AKelas({ initialTab = 'kelas' }) {
  const { pushToast, requestConfirmation } = useUIStore()
  const location = useLocation()
  const navigate = useNavigate()
  const isSchedulePage = initialTab === 'jadwal'
  const {
    activeAcademicPeriod: activeSchedulePeriod,
    activeSemesterPeriod: schedulePeriod,
    periodFilter: schedulePeriodFilter,
    academicYearOptions,
    semesterOptions,
    setAcademicYear,
    setSemester,
    resetToActivePeriod,
    isViewingArchivePeriod: isViewingScheduleArchive
  } = useActiveAcademicPeriod({
    storageKey: 'edusmart.admin.jadwal.periodFilter'
  })
  const routeClassId = React.useMemo(() => {
    const params = new URLSearchParams(location.search)
    return String(params.get('kelas') || '').trim()
  }, [location.search])
  const [initialRouteClassId] = useState(routeClassId)

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
      pushToast('success', `Akses diizinkan. Selamat datang di ${isSchedulePage ? 'Jadwal Pelajaran' : 'Manajemen Kelas'}.`)
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
  const [tab, setTab] = useState(isSchedulePage ? 'jadwal' : 'kelas')
  const [loading, setLoading] = useState(false)

  /* Data umum: guru & siswa */
  const [guruList, setGuruList] = useState([])
  const [siswaList, setSiswaList] = useState([])
  const [classDetailLoading, setClassDetailLoading] = useState(false)
  const [selectedStudentsLoadedKey, setSelectedStudentsLoadedKey] = useState('')
  const [promotionSiswaList, setPromotionSiswaList] = useState([])
  const [promotionStudentsLoaded, setPromotionStudentsLoaded] = useState(false)
  const [promotionStudentsLoading, setPromotionStudentsLoading] = useState(false)

  /* =========================================================
     TAB 1 — KELAS & JADWAL + STRUKTUR KELAS
  ========================================================= */
  const [kelas, setKelas] = useState([])
  const [filterGrade, setFilterGrade] = useState('')
  const [kelasSelected, setKelasSelected] = useState('')
  const [jadwal, setJadwal] = useState([])
  const [jadwalLoadedKey, setJadwalLoadedKey] = useState('')
  const [filterHari, setFilterHari] = useState('')
  const [academicPeriod, setAcademicPeriod] = useState(() => resolveAcademicPeriod())
  const [scheduleDefaultScope, setScheduleDefaultScope] = useState(SCHEDULE_SCOPE_YEAR)
  const [deletedHistoryOpen, setDeletedHistoryOpen] = useState(false)
  const [deletedHistoryLoading, setDeletedHistoryLoading] = useState(false)
  const [deletedClassHistories, setDeletedClassHistories] = useState([])
  const [selectedHistoryId, setSelectedHistoryId] = useState('')
  const [restoringHistoryId, setRestoringHistoryId] = useState('')

  // Form buat kelas
  const [newGrade, setNewGrade] = useState('')
  const [newSuffix, setNewSuffix] = useState('')
  const selObj = React.useMemo(() => kelas.find(k => k.id === kelasSelected) || null, [kelas, kelasSelected])
  const newClassCohortYear = React.useMemo(() => (
    newGrade ? inferCohortYear(newGrade, academicPeriod.startYear) : ''
  ), [academicPeriod.startYear, newGrade])
  const newClassCohortHelp = React.useMemo(() => {
    if (!newGrade || !newClassCohortYear) {
      return 'Pilih grade untuk melihat angkatan masuk siswa pada periode aktif.'
    }

    return `Kelas ${newGrade} pada ${academicPeriod.tahunAjaran} berarti angkatan masuk ${newClassCohortYear}.`
  }, [academicPeriod.tahunAjaran, newClassCohortYear, newGrade])

  // Struktur kelas
  const [waliGuruId, setWaliGuruId] = useState('')
  const [ketuaUid, setKetuaUid] = useState('')

  // Mata Pelajaran
  const [mapelList, setMapelList] = useState([])
  const [newMapel, setNewMapel] = useState('')

  // Form Jadwal
  const [form, setForm] = useState({
    hari: '',
    mapel: '',
    guruId: '',
    jamMulai: '',
    jamSelesai: '',
    periodeBerlaku: SCHEDULE_SCOPE_YEAR
  })
  const [editId, setEditId] = useState(null)
  const [editData, setEditData] = useState(null)
  const [exportClassId, setExportClassId] = useState('')
  const [exportFormat, setExportFormat] = useState('excel')
  const [exportingJadwal, setExportingJadwal] = useState(false)

  const [promotionModalOpen, setPromotionModalOpen] = useState(false)
  const [promotionFilterGrade, setPromotionFilterGrade] = useState('')
  const [promotionFilterKelas, setPromotionFilterKelas] = useState('')
  const [promotionSelectedIds, setPromotionSelectedIds] = useState([])
  const [promotionRetainReason, setPromotionRetainReason] = useState('Tidak naik kelas')
  const [promotionLoading, setPromotionLoading] = useState(false)
  const [promotionQueryHandled, setPromotionQueryHandled] = useState(false)

  const invalidateAcademicQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'academic-summary'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'student-options'] })
  }, [])

  const loadSelectedClassData = useCallback(async ({ includeSchedule = false, force = false } = {}) => {
    if (!kelasSelected) return

    const studentKey = buildStudentDetailKey(kelasSelected)
    const scheduleKey = buildScheduleDetailKey(kelasSelected, schedulePeriod)
    const needsStudents = !isSchedulePage && (force || selectedStudentsLoadedKey !== studentKey)
    const needsSchedule = includeSchedule && (force || jadwalLoadedKey !== scheduleKey)
    const needsMapel = includeSchedule && mapelList.length === 0

    if (!needsStudents && !needsSchedule && !needsMapel) return

    setClassDetailLoading(true)
    try {
      const params = {
        class_id: kelasSelected,
        include_students: needsStudents,
        include_schedule: needsSchedule,
        include_mapel: needsMapel,
        tahun_ajaran: schedulePeriod.tahunAjaran,
        semester: schedulePeriod.semester,
        students_limit: 1000
      }

      if (force) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'academic-summary'] })
      }

      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.admin.academicSummary(params),
        queryFn: async () => {
          const { data, error } = await supabase.admin.academicSummary(params)
          if (error) throw error
          return data
        },
        staleTime: force ? 0 : 60 * 1000,
      })

      const nextStudents = needsStudents ? mapStudentRows(data?.selected_students || []) : null
      const nextSchedule = needsSchedule
        ? mapScheduleRows(filterSchedulesForSemester(data?.schedule || [], schedulePeriod.semester), schedulePeriod)
        : null
      const nextMapel = needsMapel ? mapSubjectRows(data?.mapel || []) : null

      startTransition(() => {
        if (needsStudents) {
          setSiswaList(nextStudents)
          setSelectedStudentsLoadedKey(studentKey)
          setWaliGuruId(data?.selected_structure?.wali_guru_id || '')
          setKetuaUid(data?.selected_structure?.ketua_siswa_id || '')
        }
        if (needsSchedule) {
          setJadwal(nextSchedule)
          setJadwalLoadedKey(scheduleKey)
        }
        if (needsMapel) {
          setMapelList(nextMapel)
        }
      })
    } catch (error) {
      console.error('Error loading selected class data:', error)
      pushToast('error', error?.message || 'Gagal memuat detail kelas')
    } finally {
      setClassDetailLoading(false)
    }
  }, [
    isSchedulePage,
    jadwalLoadedKey,
    kelasSelected,
    mapelList.length,
    pushToast,
    schedulePeriod,
    selectedStudentsLoadedKey
  ])

  /* ====== EFFECTS ====== */
  useEffect(() => {
    setTab(isSchedulePage ? 'jadwal' : 'kelas')
  }, [isSchedulePage])

  // Load guru & siswa setelah password benar
  useEffect(() => {
    if (!isAuthorized) return
    
    const loadData = async () => {
      setLoading(true)
      try {
        const params = {
          class_id: initialRouteClassId,
          include_students: !isSchedulePage,
          include_schedule: isSchedulePage,
          include_mapel: isSchedulePage,
          students_limit: 1000
        }

        const data = await queryClient.fetchQuery({
          queryKey: queryKeys.admin.academicSummary(params),
          queryFn: async () => {
            const { data, error } = await supabase.admin.academicSummary(params)
            if (error) throw error
            return data
          },
          staleTime: 60 * 1000,
        })

        const nextPeriod = resolveAcademicPeriod(data?.settings || {})
        const kelasRows = mapClassRows(data?.kelas || [])
        const selectedClassId = data?.selected_class_id || initialRouteClassId || kelasRows[0]?.id || ''
        const scheduleRows = mapScheduleRows(data?.schedule || [], nextPeriod)

        startTransition(() => {
          setAcademicPeriod(nextPeriod)
          setGuruList(mapTeacherOptions(data?.guru || []))
          setKelas(kelasRows)
          setKelasSelected((prev) => {
            if (selectedClassId && kelasRows.some((row) => row.id === selectedClassId)) return selectedClassId
            if (prev && kelasRows.some((row) => row.id === prev)) return prev
            return kelasRows.length ? kelasRows[0].id : ''
          })
          setWaliGuruId(data?.selected_structure?.wali_guru_id || '')
          setKetuaUid(data?.selected_structure?.ketua_siswa_id || '')
          setSiswaList(mapStudentRows(data?.selected_students || []))
          setSelectedStudentsLoadedKey(!isSchedulePage && selectedClassId ? buildStudentDetailKey(selectedClassId) : '')

          if (isSchedulePage) {
            setJadwal(scheduleRows)
            setJadwalLoadedKey(selectedClassId ? buildScheduleDetailKey(selectedClassId, nextPeriod) : '')
            setMapelList(mapSubjectRows(data?.mapel || []))
          }
        })
      } catch (error) {
        console.error('Error loading initial data:', error)
        pushToast('error', error?.message || 'Gagal memuat data akademik')
      } finally {
        setLoading(false)
      }
    }
    
    loadData()
  }, [initialRouteClassId, isAuthorized, isSchedulePage, pushToast])

  useEffect(() => {
    if (!isAuthorized || promotionQueryHandled || typeof window === 'undefined') return

    const url = new URL(window.location.href)
    if (url.searchParams.get('openPromotion') !== '1') return

    setPromotionQueryHandled(true)
    setTab('kelas')
    openPromotionModal()
    pushToast('info', 'Pilih siswa yang tidak naik kelas. Saat tahun ajaran baru diaktifkan, siswa ini tetap di kelas asal.', {
      title: 'Pengecualian kenaikan kelas',
      duration: 7000
    })
    url.searchParams.delete('openPromotion')
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
  }, [isAuthorized, promotionQueryHandled, pushToast])

  // Load struktur kelas ketika kelasSelected berubah. Jadwal dipisah agar tab Kelas tetap ringan.
  useEffect(() => {
    if (!isAuthorized || !kelasSelected || isSchedulePage) return
    loadSelectedClassData()
  }, [isAuthorized, isSchedulePage, kelasSelected, loadSelectedClassData])

  useEffect(() => {
    if (!isAuthorized || tab !== 'jadwal' || !kelasSelected) return

    const key = `${kelasSelected}|${schedulePeriod.tahunAjaran}|${schedulePeriod.semester}`
    if (jadwalLoadedKey === key) return

    loadSelectedClassData({ includeSchedule: true })
  }, [
    isAuthorized,
    jadwalLoadedKey,
    kelasSelected,
    loadSelectedClassData,
    mapelList.length,
    schedulePeriod.semester,
    schedulePeriod.tahunAjaran,
    tab
  ])

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

  /* ================== LOADERS ================== */
  const loadSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('id, tahun_ajaran, semester_aktif, periode_mulai, periode_selesai, periode_ganjil_mulai, periode_ganjil_selesai, periode_genap_mulai, periode_genap_selesai, jadwal_periode_berlaku')
        .order('id')
        .limit(1)
        .maybeSingle()

      if (error && error.code !== 'PGRST116') throw error

      const resolved = resolveAcademicPeriod(data || {})
      setAcademicPeriod(resolved)
      const defaultScope = normalizeScheduleScope(data?.jadwal_periode_berlaku)
      setScheduleDefaultScope(defaultScope)
      setForm((prev) => ({ ...prev, periodeBerlaku: defaultScope }))
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
      setKelasSelected((prev) => {
        if (routeClassId && rows.some((r) => r.id === routeClassId)) return routeClassId
        if (prev && rows.some((r) => r.id === prev)) return prev
        return rows.length ? rows[0].id : ''
      })
    } catch (error) {
      console.error('Error loading kelas:', error)
      pushToast('error', 'Gagal memuat data kelas')
      throw error
    }
  }, [pushToast])

  const loadJadwal = useCallback(async () => {
    if (!kelasSelected) return

    try {
      const { data, error } = await supabase
        .from('jadwal')
        .select('*')
        .eq('kelas_id', kelasSelected)
        .eq('tahun_ajaran', schedulePeriod.tahunAjaran)
        .order('hari')
        .order('jam_mulai')

      if (error) throw error

      const rows = filterSchedulesForSemester(data || [], schedulePeriod.semester).map(j => ({
        id: j.id,
        hari: j.hari,
        mapel: normalizeMapelName(j.mapel),
        guruId: j.guru_id,
        guruNama: j.guru_nama || '',
        jamMulai: toTimeHHMM(j.jam_mulai),
        jamSelesai: toTimeHHMM(j.jam_selesai),
        tahunAjaran: j.tahun_ajaran || schedulePeriod.tahunAjaran,
        semester: j.semester || schedulePeriod.semester,
        periodeBerlaku: normalizeScheduleScope(j.periode_berlaku)
      }))

      rows.sort((a, b) => {
        const ai = HARI_OPTS.indexOf(a.hari)
        const bi = HARI_OPTS.indexOf(b.hari)
        if (ai !== bi) return ai - bi
        return toMinutes(a.jamMulai) - toMinutes(b.jamMulai)
      })

      setJadwal(rows)
      setJadwalLoadedKey(`${kelasSelected}|${schedulePeriod.tahunAjaran}|${schedulePeriod.semester}`)
    } catch (error) {
      console.error('Error loading jadwal:', error)
      pushToast('error', 'Gagal memuat jadwal')
      throw error
    }
  }, [kelasSelected, pushToast, schedulePeriod.semester, schedulePeriod.tahunAjaran])

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
    promotionSiswaList.filter((siswa) => {
      const status = String(siswa.status || 'active').toLowerCase()
      return status === 'active' || status === ''
    })
  ), [promotionSiswaList])

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

  const selectedDeletedHistory = React.useMemo(() => {
    return deletedClassHistories.find((item) => String(item.id) === String(selectedHistoryId)) || deletedClassHistories[0] || null
  }, [deletedClassHistories, selectedHistoryId])

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

  function formatHistoryDate(value) {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value)
    return date.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  function selectKelas(id, { openSchedule = false } = {}) {
    if (!id) return
    if (openSchedule && !isSchedulePage) {
      navigate(`/admin/jadwal?kelas=${encodeURIComponent(id)}`)
      return
    }
    setKelasSelected(id)
    setFilterHari('')
    setJadwal([])
    setJadwalLoadedKey('')
    setSelectedStudentsLoadedKey('')
    setSiswaList([])
    setEditId(null)
    setEditData(null)
    setExportClassId(id)
    if (isSchedulePage) {
      navigate(`/admin/jadwal?kelas=${encodeURIComponent(id)}`, { replace: true })
    }
  }

  const loadDeletedClassHistory = useCallback(async () => {
    setDeletedHistoryLoading(true)
    try {
      const res = await apiFetch('/api/admin/classes/deleted-history')
      if (res.error) throw res.error
      const rows = Array.isArray(res.raw?.data) ? res.raw.data : Array.isArray(res.data) ? res.data : []
      setDeletedClassHistories(rows)
      setSelectedHistoryId((prev) => {
        if (prev && rows.some((row) => String(row.id) === String(prev))) return prev
        return rows[0]?.id ? String(rows[0].id) : ''
      })
    } catch (error) {
      console.error('Error loading deleted class history:', error)
      pushToast('error', error?.message || 'Gagal memuat riwayat kelas terhapus')
    } finally {
      setDeletedHistoryLoading(false)
    }
  }, [pushToast, routeClassId])

  async function openDeletedClassHistory() {
    setDeletedHistoryOpen(true)
    await loadDeletedClassHistory()
  }

  async function restoreDeletedClass(history) {
    if (!history?.id || history.restored_at) return
    const className = history.class_name || history.class_id
    const confirmed = window.confirm(`Pulihkan kelas ${className} beserta struktur dan jadwal yang tersimpan?`)
    if (!confirmed) return

    try {
      setRestoringHistoryId(String(history.id))
      const res = await apiFetch(`/api/admin/classes/deleted-history/${encodeURIComponent(history.id)}/restore`, {
        method: 'POST'
      })
      if (res.error) throw res.error

      pushToast('success', `Kelas ${className} berhasil dipulihkan`)
      setKelasSelected(history.class_id)
      setJadwal([])
      setJadwalLoadedKey('')
      await Promise.all([loadKelas(), loadDeletedClassHistory()])
    } catch (error) {
      console.error('Error restoring class:', error)
      pushToast('error', error?.message || 'Gagal memulihkan kelas')
    } finally {
      setRestoringHistoryId('')
    }
  }

  function buildJadwalKey({ hari, mapel, jamMulai, jamSelesai, periodeBerlaku = SCHEDULE_SCOPE_YEAR }) {
    const cleanMapel = normalizeMapelName(mapel).replace(/\s+/g, '_').replace(/[^\w-]/g, '')
    const cleanHari = (hari || '').replace(/\s+/g, '_')
    const cleanJamMulai = (jamMulai || '').replace(/:/g, '')
    const cleanJamSelesai = (jamSelesai || '').replace(/:/g, '')
    const cleanYear = (academicPeriod.tahunAjaran || '').replace(/[^\w]/g, '')
    const cleanScope = normalizeScheduleScope(periodeBerlaku).replace(/[^\w]/g, '')

    return `${kelasSelected}-${cleanYear}-${cleanScope}-${cleanHari}-${cleanMapel}-${cleanJamMulai}-${cleanJamSelesai}`
  }

  async function persistAcademicPeriod(nextPeriod, { silent = false, manualRolloverCompleted = false } = {}) {
    const tahunAjaran = normalizeAcademicYear(nextPeriod?.tahunAjaran)
    const semester = normalizeSemester(nextPeriod?.semester)
    const ganjilRange = resolveAcademicPeriod({
      tahun_ajaran: tahunAjaran,
      semester_aktif: 'Ganjil',
      periode_mulai: nextPeriod?.periodeGanjilMulai,
      periode_selesai: nextPeriod?.periodeGanjilSelesai
    })
    const genapRange = resolveAcademicPeriod({
      tahun_ajaran: tahunAjaran,
      semester_aktif: 'Genap',
      periode_mulai: nextPeriod?.periodeGenapMulai,
      periode_selesai: nextPeriod?.periodeGenapSelesai
    })
    const activeRangeFields = semesterRangeFields(semester)
    const activeStart = activeRangeFields?.camelStart ? nextPeriod?.[activeRangeFields.camelStart] : nextPeriod?.periodeMulai
    const activeEnd = activeRangeFields?.camelEnd ? nextPeriod?.[activeRangeFields.camelEnd] : nextPeriod?.periodeSelesai
    const resolvedCandidate = resolveAcademicPeriod({
      tahun_ajaran: tahunAjaran,
      semester_aktif: semester,
      periode_mulai: activeStart || nextPeriod?.periodeMulai || nextPeriod?.startsAt,
      periode_selesai: activeEnd || nextPeriod?.periodeSelesai || nextPeriod?.endsAt
    })

    if (!tahunAjaran || !semester) {
      throw new Error('Tahun ajaran atau semester tidak valid')
    }
    if (!ganjilRange.customRange || !genapRange.customRange || !resolvedCandidate.customRange) {
      throw new Error('Rentang bulan semester Ganjil/Genap tidak valid untuk tahun ajaran ini')
    }

    const payload = {
      tahun_ajaran: tahunAjaran,
      semester_aktif: semester,
      periode_mulai: resolvedCandidate.startsAt,
      periode_selesai: resolvedCandidate.endsAt,
      periode_ganjil_mulai: ganjilRange.startsAt,
      periode_ganjil_selesai: ganjilRange.endsAt,
      periode_genap_mulai: genapRange.startsAt,
      periode_genap_selesai: genapRange.endsAt,
      manual_rollover_completed: manualRolloverCompleted,
      updated_at: new Date().toISOString()
    }

    let { error, raw } = await supabase.admin.applyAcademicPeriod(payload)
    if (error?.code === 'academic_period_calendar_confirmation_required') {
      const serverCalendar = raw?.data?.server_calendar || {}
      const confirmedCalendar = await requestConfirmation({
        title: 'Validasi kalender server',
        message: error.message || 'Periode yang dipilih perlu dikonfirmasi ulang.',
        confirmText: 'Ya, tetap simpan',
        cancelText: 'Batal',
        tone: 'warning',
        details: [
          `Tanggal server: ${serverCalendar.today || '-'} (${serverCalendar.timezone || 'Asia/Jakarta'})`,
          `Kalender server: ${serverCalendar.tahun_ajaran || '-'} - Semester ${serverCalendar.semester || '-'}`,
          `Target simpan: ${tahunAjaran} - Semester ${semester}`
        ]
      })
      if (!confirmedCalendar) {
        throw new Error('Perubahan periode dibatalkan.')
      }

      const retry = await supabase.admin.applyAcademicPeriod({
        ...payload,
        calendar_confirmed: true
      })
      error = retry.error
    }

    if (error) throw error

    const resolved = resolveAcademicPeriod(payload)
    setAcademicPeriod(resolved)
    if (!silent) pushToast('success', `Periode aktif disimpan: ${resolved.tahunAjaran} - ${resolved.semester}`)

    return resolved
  }

  async function hasConflict({ hari, jamMulai, jamSelesai, guruId, mapel, kelasId, periodeBerlaku = SCHEDULE_SCOPE_YEAR }, ignoreId = null) {
    if (!kelasId) return 'Kelas belum dipilih'
    const scheduleScope = normalizeScheduleScope(periodeBerlaku)

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

      if (ignoreId) {
        classQuery = classQuery.neq('id', ignoreId)
      }

      const { data: sameClassSchedule, error: classError } = await classQuery
      if (classError) throw classError

      for (const j of sameClassSchedule || []) {
        if (!doScheduleScopesOverlap(scheduleScope, j.periode_berlaku)) continue
        if (timesOverlap(jamMulai, jamSelesai, j.jam_mulai, j.jam_selesai)) {
          return `Konflik dengan ${j.mapel} di kelas ini (${j.jam_mulai}-${j.jam_selesai}, berlaku ${scheduleScopeLabel(j.periode_berlaku, { short: true })})`
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

        if (ignoreId) {
          teacherQuery = teacherQuery.neq('id', ignoreId)
        }

        const { data: teacherSchedule, error: teacherError } = await teacherQuery
        if (teacherError) throw teacherError

        for (const j of teacherSchedule || []) {
          if (!doScheduleScopesOverlap(scheduleScope, j.periode_berlaku)) continue
          if (timesOverlap(jamMulai, jamSelesai, j.jam_mulai, j.jam_selesai)) {
            return `Guru bentrok di kelas ${j.kelas_id} (${j.mapel} ${j.jam_mulai}-${j.jam_selesai}, berlaku ${scheduleScopeLabel(j.periode_berlaku, { short: true })})`
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

  async function loadPromotionStudents({ force = false } = {}) {
    if (promotionStudentsLoaded && !force) return

    setPromotionStudentsLoading(true)
    try {
      const params = {
        all: true,
        per_page: 10000,
        status: 'active'
      }

      if (force) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'student-options'] })
      }

      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.admin.studentOptions(params),
        queryFn: async () => {
          const { data, error } = await supabase.admin.studentOptions(params)
          if (error) throw error
          return data
        },
        staleTime: force ? 0 : 60 * 1000,
      })

      startTransition(() => {
        const rows = mapStudentRows(data?.rows || [])
        setPromotionSiswaList(rows)
        setPromotionStudentsLoaded(true)
      })
      return mapStudentRows(data?.rows || [])
    } catch (error) {
      console.error('Error loading promotion students:', error)
      pushToast('error', error?.message || 'Gagal memuat siswa untuk kenaikan kelas')
      return []
    } finally {
      setPromotionStudentsLoading(false)
    }
  }

  async function loadPromotionExceptions() {
    try {
      const { data, error } = await supabase
        .from('academic_rollover_exceptions')
        .select('student_id,reason')
        .eq('source_tahun_ajaran', academicPeriod.tahunAjaran)
        .eq('target_tahun_ajaran', nextAcademicPeriod.tahunAjaran)
        .is('resolved_at', null)

      if (error) throw error

      const rows = data || []
      setPromotionSelectedIds(rows.map((row) => row.student_id).filter(Boolean))
      const reason = rows.find((row) => String(row.reason || '').trim())?.reason
      setPromotionRetainReason(reason || 'Tidak naik kelas')
    } catch (error) {
      console.error('Error loading rollover exceptions:', error)
      setPromotionSelectedIds([])
      if (String(error?.message || '').toLowerCase().includes('academic_rollover_exceptions')) {
        pushToast('warning', 'Tabel pengecualian rollover belum siap. Jalankan migration terbaru di VPS.')
      } else {
        pushToast('warning', 'Gagal memuat pengecualian kenaikan kelas.')
      }
    }
  }

  function openPromotionModal() {
    setPromotionFilterGrade('')
    setPromotionFilterKelas(kelasSelected || '')
    setPromotionSelectedIds([])
    setPromotionRetainReason('Tidak naik kelas')
    setPromotionModalOpen(true)
    void loadPromotionStudents()
    void loadPromotionExceptions()
  }

  function closePromotionModal() {
    setPromotionModalOpen(false)
    setPromotionLoading(false)
    setPromotionSelectedIds([])
    setPromotionRetainReason('Tidak naik kelas')
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
      let availableActiveStudents = activeSiswaList
      if (!promotionStudentsLoaded) {
        availableActiveStudents = await loadPromotionStudents()
      }

      const selectedSet = new Set(promotionSelectedIds)
      const selectedSiswa = availableActiveStudents.filter((siswa) => selectedSet.has(siswa.uid))
      const selectedIds = selectedSiswa.map((siswa) => siswa.uid)
      const lines = [
        `Periode sumber: ${academicPeriod.tahunAjaran}`,
        `Periode target: ${nextAcademicPeriod.tahunAjaran}`,
        `Siswa tidak naik kelas: ${selectedIds.length}`,
        '',
        selectedIds.length
          ? 'Siswa terpilih akan tetap di kelas asal saat rollover tahun ajaran dijalankan dari Pengaturan Akademik.'
          : 'Daftar pengecualian akan dikosongkan. Semua siswa aktif akan mengikuti rollover otomatis.'
      ]

      lines.push('', 'Lanjutkan?')
      if (!window.confirm(lines.join('\n'))) return

      setPromotionLoading(true)
      const now = new Date().toISOString()

      const deleteQuery = supabase
        .from('academic_rollover_exceptions')
        .delete()
        .eq('source_tahun_ajaran', academicPeriod.tahunAjaran)
        .eq('target_tahun_ajaran', nextAcademicPeriod.tahunAjaran)
        .is('resolved_at', null)
      const { error: deleteError } = await deleteQuery
      if (deleteError) throw deleteError

      if (selectedIds.length) {
        const reason = String(promotionRetainReason || '').trim() || 'Tidak naik kelas'
        const rows = selectedIds.map((studentId) => ({
          id: createClientUuid(),
          student_id: studentId,
          source_tahun_ajaran: academicPeriod.tahunAjaran,
          target_tahun_ajaran: nextAcademicPeriod.tahunAjaran,
          reason,
          created_at: now,
          updated_at: now
        }))

        const { error: insertError } = await supabase
          .from('academic_rollover_exceptions')
          .insert(rows)
        if (insertError) throw insertError
      }

      invalidateAcademicQueries()
      pushToast(
        'success',
        selectedIds.length
          ? `${selectedIds.length} siswa disimpan sebagai pengecualian rollover.`
          : 'Daftar pengecualian rollover dikosongkan.'
      )
      closePromotionModal()
    } catch (error) {
      console.error('Error saving rollover exceptions:', error)
      pushToast('error', error.message || 'Gagal menyimpan pengecualian kenaikan kelas')
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
    const angkatan = String(newClassCohortYear || inferCohortYear(grade, academicPeriod.startYear)).trim()

    if (!angkatan) {
      pushToast('error', 'Periode akademik aktif belum valid. Periksa pengaturan tahun ajaran.')
      return
    }

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
      setKelasSelected(savedId)
      setJadwal([])
      setJadwalLoadedKey('')
      invalidateAcademicQueries()
      await loadKelas()
    } catch (error) {
      console.error('Error adding kelas:', error)
      pushToast('error', error.message || 'Gagal menambah kelas')
    } finally {
      setLoading(false)
    }
  }

  async function hapusKelas(id) {
    const targetClass = kelas.find((item) => item.id === id)
    const className = String(targetClass?.nama || targetClass?.id || id || 'kelas ini').toUpperCase()
    const loadedSelectedStudents = id === kelasSelected && selectedStudentsLoadedKey === buildStudentDetailKey(id)
    const selectedStudentCount = loadedSelectedStudents ? siswaDiKelasTerpilih.length : null

    if (selectedStudentCount > 0) {
      pushToast('error', `Kelas ${className} masih digunakan oleh ${selectedStudentCount} siswa aktif. Pindahkan siswa terlebih dahulu, baru hapus kelasnya.`, {
        title: 'Kelas masih dipakai siswa',
        duration: 7000
      })
      return
    }

    const confirmed = await requestConfirmation({
      title: 'Hapus kelas kosong?',
      message: `Kelas ${className} akan dihapus dari daftar aktif dan snapshot-nya disimpan ke riwayat pemulihan.`,
      confirmText: 'Hapus kelas',
      cancelText: 'Batal',
      tone: 'danger',
      details: [
        'Kelas hanya bisa dihapus jika tidak ada siswa aktif yang masih memakai kelas tersebut.',
        'Struktur kelas dan jadwal akan disimpan sehingga kelas kosong masih bisa dipulihkan dari riwayat.',
        'Data historis seperti absensi, tugas, dan quiz tidak ikut dihapus.'
      ]
    })

    if (!confirmed) return

    try {
      setLoading(true)

      const res = await apiFetch(`/api/admin/classes/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (res.error) throw res.error

      pushToast('success', 'Kelas berhasil dihapus dan tersimpan di riwayat pemulihan')
      if (kelasSelected === id) setKelasSelected('')
      setJadwal([])
      setJadwalLoadedKey('')
      invalidateAcademicQueries()
      await loadKelas()
      if (deletedHistoryOpen) {
        await loadDeletedClassHistory()
      }
    } catch (error) {
      console.error('Error deleting kelas:', error)
      const title = error?.code === 'class_has_students'
        ? 'Kelas masih dipakai siswa'
        : error?.status === 409
          ? 'Kelas belum bisa dihapus'
          : 'Gagal menghapus kelas'
      pushToast('error', error?.message || 'Gagal menghapus kelas', {
        title,
        duration: 7000
      })
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
      invalidateAcademicQueries()
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
      invalidateAcademicQueries()
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
      invalidateAcademicQueries()
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
      invalidateAcademicQueries()
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
    if (isViewingScheduleArchive) {
      pushToast('warning', 'Jadwal arsip hanya untuk dilihat. Kembali ke periode aktif untuk menambah jadwal.')
      return
    }
    if (!kelasSelected) {
      pushToast('error', 'Pilih kelas terlebih dahulu.')
      return
    }

    const { hari, guruId } = form
    const jamMulai = toTimeHHMM(form.jamMulai)
    const jamSelesai = toTimeHHMM(form.jamSelesai)
    const mapel = normalizeMapelName(form.mapel)
    const periodeBerlaku = normalizeScheduleScope(form.periodeBerlaku || scheduleDefaultScope)
    const scheduleSemester = scheduleScopeToSemester(periodeBerlaku)

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
        kelasId: kelasSelected,
        periodeBerlaku
      })

      if (conflictMsg) {
        pushToast('error', conflictMsg)
        return
      }

      const id = buildJadwalKey({ hari, mapel, jamMulai, jamSelesai, periodeBerlaku })
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
          semester: scheduleSemester || null,
          periode_berlaku: periodeBerlaku,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      pushToast('success', 'Jadwal berhasil ditambahkan')
      setForm({
        hari: '',
        mapel: '',
        guruId: '',
        jamMulai: '',
        jamSelesai: '',
        periodeBerlaku: scheduleDefaultScope
      })
      invalidateAcademicQueries()
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
    if (isViewingScheduleArchive) {
      pushToast('warning', 'Jadwal arsip hanya untuk dilihat. Kembali ke periode aktif untuk menghapus jadwal.')
      return
    }
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
      invalidateAcademicQueries()
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
    setEditData({
      ...row,
      periodeBerlaku: normalizeScheduleScope(row.periodeBerlaku)
    })
  }

  function cancelEdit() {
    setEditId(null)
    setEditData(null)
  }

  async function saveEdit() {
    if (!editData) return
    if (isViewingScheduleArchive) {
      pushToast('warning', 'Jadwal arsip hanya untuk dilihat. Kembali ke periode aktif untuk mengedit jadwal.')
      return
    }

    const { hari, guruId } = editData
    const jamMulai = toTimeHHMM(editData.jamMulai)
    const jamSelesai = toTimeHHMM(editData.jamSelesai)
    const mapel = normalizeMapelName(editData.mapel)
    const periodeBerlaku = normalizeScheduleScope(editData.periodeBerlaku)
    const scheduleSemester = scheduleScopeToSemester(periodeBerlaku)

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
        kelasId: kelasSelected,
        periodeBerlaku
      }, editId)

      if (conflictMsg) {
        pushToast('error', conflictMsg)
        return
      }

      const newId = buildJadwalKey({ hari, mapel, jamMulai, jamSelesai, periodeBerlaku })
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
            semester: scheduleSemester || null,
            periode_berlaku: periodeBerlaku,
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
            semester: scheduleSemester || null,
            periode_berlaku: periodeBerlaku,
            updated_at: new Date().toISOString()
          })
          .eq('id', editId)
          .eq('kelas_id', kelasSelected)

        if (error) throw error
      }

      pushToast('success', 'Jadwal berhasil diupdate')
      setEditId(null)
      setEditData(null)
      invalidateAcademicQueries()
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
    jamSelesai: toTimeHHMM(row?.jam_selesai || row?.jamSelesai),
    periodeBerlaku: normalizeScheduleScope(row?.periode_berlaku || row?.periodeBerlaku)
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
        .eq('tahun_ajaran', schedulePeriod.tahunAjaran)
        .order('kelas_id')
        .order('hari')
        .order('jam_mulai')

      if (error) throw error

      const grouped = {}
      filterSchedulesForSemester(data || [], schedulePeriod.semester).forEach((raw) => {
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
        .eq('tahun_ajaran', schedulePeriod.tahunAjaran)
        .order('hari')
        .order('jam_mulai')
      if (error) throw error
      rows = sortJadwalRows(filterSchedulesForSemester(data || [], schedulePeriod.semester).map(normalizeScheduleRow))
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
        title={isSchedulePage ? 'Akses Jadwal Pelajaran' : 'Akses Manajemen Kelas'}
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
                <div className={`p-3 rounded-2xl ${isSchedulePage ? 'bg-orange-100' : 'bg-blue-100'}`}>
                  <span className={`text-2xl ${isSchedulePage ? 'text-orange-600' : 'text-blue-600'}`}>
                    {isSchedulePage ? '📅' : '🏫'}
                  </span>
                </div>
                <div>
                  <h1 className="page-title-heading">{isSchedulePage ? 'Jadwal Pelajaran' : 'Manajemen Kelas'}</h1>
                  <p className="page-title-description">
                    {isSchedulePage
                      ? 'Kelola jadwal pelajaran dan mata pelajaran per kelas.'
                      : 'Kelola data kelas dan struktur kelas aktif.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {!isSchedulePage && (
                  <>
                    <button
                      type="button"
                      className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center space-x-2 bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                      onClick={openPromotionModal}
                    >
                      <span>⬆️</span>
                      <span>Pengecualian Rollover</span>
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center space-x-2 bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                      onClick={openDeletedClassHistory}
                    >
                      <span>↩</span>
                      <span>Riwayat Terhapus</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="space-y-6">
            {/* Loading password tetap blocking; refresh data biasa dibuat kontekstual agar halaman tetap responsif. */}
            {passwordLoading && (
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

            {loading && !passwordLoading && (
              <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                    <div>
                      <p className="text-sm font-semibold text-slate-700">Memuat data terbaru...</p>
                      <p className="text-xs text-slate-500">Konten yang sudah ada tetap bisa digunakan.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:w-64">
                    <div className="h-2 rounded-full bg-slate-100" />
                    <div className="h-2 rounded-full bg-slate-100" />
                    <div className="h-2 rounded-full bg-slate-100" />
                  </div>
                </div>
              </div>
            )}

            {/* ===================== TAB: KELAS ===================== */}
            {tab === 'kelas' && (
              <div className="space-y-6">
                {/* Statistik Ringkas */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                        <p className="text-sm text-gray-500">Siswa Kelas Ini</p>
                        <p className="text-2xl font-bold text-gray-900">{classDetailLoading ? '...' : siswaDiKelasTerpilih.length}</p>
                      </div>
                      <div className="p-3 bg-emerald-100 rounded-lg">
                        <span className="text-xl">👥</span>
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
                        Pilih kelas untuk mengelola struktur kelas. Jadwal sudah dipindahkan ke menu Jadwal di sidebar.
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
                            if (first) selectKelas(first.id)
                          }}
                        >
                          <option value="">Semua Grade</option>
                          {GRADE_OPTS.map(g => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="button"
                        className="px-3 py-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100"
                        onClick={openDeletedClassHistory}
                      >
                        Riwayat Kelas Terhapus
                      </button>
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
                          onClick={() => selectKelas(k.id)}
                          title={k.nama || k.id}
                        >
                          <span className="block text-lg font-bold">{(k.nama || k.id).toUpperCase()}</span>
                          <span className="text-xs opacity-75 mt-1">Grade {k.grade}</span>
                          <span className="text-[11px] opacity-75">Angkatan masuk {k.angkatan || '-'}</span>
                        </button>

                        <button
                          type="button"
                          className="absolute -right-2 -top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 shadow-lg transition hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={(e) => {
                            e.stopPropagation()
                            hapusKelas(k.id)
                          }}
                          disabled={loading}
                          title="Hapus kelas kosong"
                          aria-label={`Hapus kelas ${k.nama || k.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
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

                {/* Form Kelas */}
                <div className="grid grid-cols-1 gap-6">
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
	                          Angkatan Masuk
	                        </label>
	                        <div className="block w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-900 shadow-sm">
	                          {newClassCohortYear || '-'}
	                        </div>
	                        <p className="text-xs text-gray-500 mt-1">
	                          {newClassCohortHelp}
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
	                    <div className="mt-6 border-t border-gray-100 pt-5">
	                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
	                        <div>
	                          <h4 className="text-sm font-bold text-gray-900">Siswa Di Kelas Ini</h4>
	                          <p className="text-xs text-gray-500">
	                            Label angkatan menunjukkan tahun masuk cohort; riwayat menunjukkan periode kelas yang pernah diikuti.
	                          </p>
	                        </div>
	                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
	                          {classDetailLoading ? 'Memuat...' : `${siswaDiKelasTerpilih.length} siswa`}
	                        </span>
	                      </div>

	                      <div className="mt-3 overflow-hidden rounded-xl border border-gray-200">
	                        {classDetailLoading ? (
	                          <div className="px-4 py-5 text-sm text-gray-500">Memuat siswa dan riwayat kelas...</div>
	                        ) : siswaDiKelasTerpilih.length ? (
	                          <div className="divide-y divide-gray-100">
	                            {siswaDiKelasTerpilih.map((siswa) => (
	                              <div key={siswa.uid} className="px-4 py-3">
	                                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
	                                  <div className="min-w-0">
	                                    <p className="truncate text-sm font-semibold text-gray-900">{siswa.nama}</p>
	                                    <p className="truncate text-xs text-gray-500">{siswa.email || 'Tanpa email'}</p>
	                                  </div>
	                                  <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
	                                    Angkatan masuk {siswa.angkatan || '-'}
	                                  </span>
	                                </div>
	                                <p className="mt-2 text-xs text-gray-600">
	                                  Riwayat: {formatStudentClassHistory(siswa.classHistory)}
	                                </p>
	                              </div>
	                            ))}
	                          </div>
	                        ) : (
	                          <div className="px-4 py-5 text-sm text-gray-500">Belum ada siswa aktif di kelas ini.</div>
	                        )}
	                      </div>
	                    </div>
	                  </div>
	                )}

              </div>
            )}

            {/* ===================== TAB: JADWAL ===================== */}
            {tab === 'jadwal' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                  <div className="xl:col-span-1 bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                      <span className="p-2 bg-orange-100 rounded-lg">📅</span>
                      <span>Pilih Kelas Jadwal</span>
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Kelas</label>
                        <select
                          className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white shadow-sm text-gray-900"
                          value={kelasSelected}
                          onChange={(event) => selectKelas(event.target.value)}
                        >
                          <option value="">Pilih kelas</option>
                          {kelas.map((item) => (
                            <option key={item.id} value={item.id}>
                              {String(item.nama || item.id).toUpperCase()}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="rounded-xl border border-orange-100 bg-orange-50 p-4 text-sm text-orange-900">
	                        <p className="font-semibold">Periode jadwal</p>
	                        <p className="mt-1">{schedulePeriod.tahunAjaran} - Tampilan Semester {schedulePeriod.semester}</p>
	                        <p className="mt-2 text-xs text-orange-700">
	                          Jadwal tahunan selalu tampil. Jadwal khusus semester hanya tampil pada semester yang sesuai.
	                        </p>
                          <p className="mt-1 text-xs text-orange-700">
                            Default jadwal baru: {scheduleScopeLabel(scheduleDefaultScope)}. Ubah dari Pengaturan Akademik.
                          </p>
                      </div>
                      <AcademicPeriodArchiveFilter
                        activeAcademicPeriod={activeSchedulePeriod}
                        periodFilter={schedulePeriodFilter}
                        academicYearOptions={academicYearOptions}
                        semesterOptions={semesterOptions}
                        setAcademicYear={setAcademicYear}
                        setSemester={setSemester}
                        resetToActivePeriod={resetToActivePeriod}
                        title="Periode Data"
                        compact
                      />
                      {kelasSelected && (
                        <button
                          type="button"
                          className="w-full px-4 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium"
                          onClick={() => navigate('/admin/kelas')}
                        >
                          Edit Struktur Kelas
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="xl:col-span-2 bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-5">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
                          <span className="p-2 bg-purple-100 rounded-lg">📚</span>
                          <span>Mata Pelajaran</span>
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">Dipakai saat membuat jadwal pelajaran.</p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                        <input
                          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-gray-900"
                          placeholder="Nama mapel baru"
                          value={newMapel}
                          onChange={(event) => setNewMapel(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') tambahMapel()
                          }}
                        />
                        <button
                          type="button"
                          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                          onClick={tambahMapel}
                          disabled={!newMapel.trim()}
                        >
                          Tambah
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {mapelList.map((mapel) => (
                        <span
                          key={mapel.id}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-50 text-purple-800 border border-purple-100 rounded-full text-sm"
                        >
                          <span>{mapel.nama}</span>
                          <button
                            type="button"
                            className="text-purple-500 hover:text-red-600"
                            title="Hapus mapel"
                            onClick={() => hapusMapel(mapel.id)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {!mapelList.length && (
                        <p className="text-sm text-gray-500">Belum ada mata pelajaran.</p>
                      )}
                    </div>
                  </div>
                </div>

                {!kelasSelected && (
                  <div className="bg-white rounded-2xl shadow-lg p-10 border border-gray-200 text-center text-gray-500">
                    <div className="w-16 h-16 mx-auto mb-4 bg-orange-100 rounded-full flex items-center justify-center text-2xl">📅</div>
                    <p className="text-lg font-semibold text-gray-700">Pilih kelas untuk membuka jadwal</p>
                    <p className="text-sm mt-1">Data jadwal baru dimuat saat submenu ini dibuka agar halaman Kelas tetap ringan.</p>
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
	                          Periode: {schedulePeriod.tahunAjaran} • tampilan Semester {schedulePeriod.semester}
	                        </p>
                        {isViewingScheduleArchive && (
                          <p className="text-xs text-amber-700 mt-1">
                            Mode arsip: perubahan jadwal dinonaktifkan.
                          </p>
                        )}
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

                    <SchedulePreviewTable
                      exportDays={exportDays}
                      jadwalMatrix={jadwalMatrix}
                    />
                    {/* Form Tambah Jadwal */}
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-5 mb-6 border border-blue-200">
                      <h4 className="font-semibold text-blue-900 mb-4 flex items-center space-x-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        <span>Tambah Jadwal Baru</span>
                      </h4>
                      <p className="mb-4 rounded-lg border border-blue-100 bg-white/70 px-3 py-2 text-xs font-medium text-blue-800">
                        Masa berlaku mengikuti Pengaturan Akademik: {scheduleScopeLabel(scheduleDefaultScope)}.
                      </p>
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
                            disabled={isViewingScheduleArchive || loading || !form.hari || !form.mapel || !form.jamMulai || !form.jamSelesai}
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
	                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
	                              Berlaku
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
	                                  <td className="px-6 py-4 whitespace-nowrap">
                                      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                                        {scheduleScopeLabel(editData.periodeBerlaku, { short: true })}
                                      </span>
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
	                                  <td className="px-6 py-4 whitespace-nowrap">
	                                    <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
	                                      {scheduleScopeLabel(j.periodeBerlaku, { short: true })}
	                                    </span>
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
	                              <td colSpan="6" className="px-6 py-12 text-center text-gray-500">
                                <div className="w-20 h-20 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                                  <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                </div>
	                                <p className="text-lg font-medium text-gray-600">
	                                  {filterHari
	                                    ? `Tidak ada jadwal untuk hari ${filterHari}`
	                                    : `Belum ada jadwal yang berlaku untuk Semester ${schedulePeriod.semester}.`}
	                                </p>
	                                <p className="text-sm mt-1">Tambahkan jadwal tahunan, atau jadwal khusus semester jika memang berbeda.</p>
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

            {deletedHistoryOpen && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
                  <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <span className="p-2 bg-rose-100 text-rose-700 rounded-lg">↩</span>
                        <span>Riwayat Kelas Terhapus</span>
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Lihat snapshot kelas yang sudah dihapus, termasuk struktur dan jadwal yang bisa dipulihkan.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                      onClick={() => setDeletedHistoryOpen(false)}
                      disabled={deletedHistoryLoading || Boolean(restoringHistoryId)}
                    >
                      Tutup
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] min-h-0 flex-1">
                    <div className="border-r border-gray-200 bg-gray-50 p-4 overflow-y-auto">
                      {deletedHistoryLoading ? (
                        <div className="py-10 text-center text-sm text-gray-500">
                          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-rose-600 mb-3" />
                          <p>Memuat riwayat...</p>
                        </div>
                      ) : deletedClassHistories.length ? (
                        <div className="space-y-2">
                          {deletedClassHistories.map((history) => {
                            const active = selectedDeletedHistory && String(selectedDeletedHistory.id) === String(history.id)
                            return (
                              <button
                                key={history.id}
                                type="button"
                                className={`w-full text-left rounded-xl border p-3 transition-colors ${
                                  active ? 'bg-white border-rose-300 shadow-sm' : 'bg-gray-50 border-gray-200 hover:bg-white'
                                }`}
                                onClick={() => setSelectedHistoryId(String(history.id))}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-gray-900 truncate">
                                    {String(history.class_name || history.class_id || '-').toUpperCase()}
                                  </span>
                                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                                    history.restored_at ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'
                                  }`}>
                                    {history.restored_at ? 'Dipulihkan' : 'Terhapus'}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">{formatHistoryDate(history.deleted_at)}</p>
                                <p className="text-xs text-gray-600 mt-1">
                                  {history.summary?.jadwal || 0} jadwal • {history.summary?.struktur || 0} struktur
                                </p>
                              </button>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="py-10 text-center text-sm text-gray-500">
                          <div className="w-14 h-14 mx-auto mb-3 bg-white rounded-full flex items-center justify-center text-xl">📦</div>
                          <p>Belum ada riwayat kelas terhapus.</p>
                        </div>
                      )}
                    </div>

                    <div className="p-6 overflow-y-auto">
                      {selectedDeletedHistory ? (
                        <div className="space-y-6">
                          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                            <div>
                              <h4 className="text-2xl font-bold text-gray-900">
                                {String(selectedDeletedHistory.class_name || selectedDeletedHistory.class_id || '-').toUpperCase()}
                              </h4>
                              <p className="text-sm text-gray-600 mt-1">
                                ID kelas: {selectedDeletedHistory.class_id || '-'} • Grade {selectedDeletedHistory.grade || '-'} • Angkatan {selectedDeletedHistory.angkatan || '-'}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="px-4 py-2.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                              onClick={() => restoreDeletedClass(selectedDeletedHistory)}
                              disabled={Boolean(selectedDeletedHistory.restored_at) || String(restoringHistoryId) === String(selectedDeletedHistory.id)}
                            >
                              {selectedDeletedHistory.restored_at
                                ? 'Sudah Dipulihkan'
                                : String(restoringHistoryId) === String(selectedDeletedHistory.id)
                                  ? 'Memulihkan...'
                                  : 'Pulihkan Kelas'}
                            </button>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {[
                              ['Siswa Terkait', selectedDeletedHistory.summary?.siswa || 0],
                              ['Jadwal', selectedDeletedHistory.summary?.jadwal || 0],
                              ['Absensi', selectedDeletedHistory.summary?.absensi || 0],
                              ['Tugas/Quiz', (selectedDeletedHistory.summary?.tugas || 0) + (selectedDeletedHistory.summary?.quizzes || 0)]
                            ].map(([label, value]) => (
                              <div key={label} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                <p className="text-xs text-gray-500">{label}</p>
                                <p className="text-2xl font-bold text-gray-900">{value}</p>
                              </div>
                            ))}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div className="rounded-xl border border-gray-200 p-4">
                              <p className="font-semibold text-gray-900 mb-3">Detail Penghapusan</p>
                              <dl className="space-y-2 text-gray-600">
                                <div className="flex justify-between gap-4">
                                  <dt>Dihapus</dt>
                                  <dd className="text-right text-gray-900">{formatHistoryDate(selectedDeletedHistory.deleted_at)}</dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <dt>Oleh</dt>
                                  <dd className="text-right text-gray-900">{selectedDeletedHistory.deleted_by_name || selectedDeletedHistory.deleted_by || '-'}</dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <dt>Dipulihkan</dt>
                                  <dd className="text-right text-gray-900">{formatHistoryDate(selectedDeletedHistory.restored_at)}</dd>
                                </div>
                              </dl>
                            </div>
                            <div className="rounded-xl border border-gray-200 p-4">
                              <p className="font-semibold text-gray-900 mb-3">Detail Akademik</p>
                              <dl className="space-y-2 text-gray-600">
                                <div className="flex justify-between gap-4">
                                  <dt>Tahun Ajaran</dt>
                                  <dd className="text-right text-gray-900">{selectedDeletedHistory.tahun_ajaran || selectedDeletedHistory.snapshot?.kelas?.tahun_ajaran || '-'}</dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <dt>Semester</dt>
                                  <dd className="text-right text-gray-900">{selectedDeletedHistory.semester || selectedDeletedHistory.snapshot?.kelas?.semester || '-'}</dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <dt>Sufiks</dt>
                                  <dd className="text-right text-gray-900">{selectedDeletedHistory.suffix || selectedDeletedHistory.snapshot?.kelas?.suffix || '-'}</dd>
                                </div>
                              </dl>
                            </div>
                          </div>

                          <div className="rounded-xl border border-gray-200 p-4">
                            <p className="font-semibold text-gray-900 mb-3">Struktur Kelas</p>
                            {selectedDeletedHistory.snapshot?.kelas_struktur?.length ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                <div className="rounded-lg bg-gray-50 p-3">
                                  <p className="text-xs text-gray-500">Wali Kelas</p>
                                  <p className="font-medium text-gray-900">
                                    {selectedDeletedHistory.snapshot.kelas_struktur[0]?.wali_guru_nama || selectedDeletedHistory.snapshot.kelas_struktur[0]?.wali_guru_id || '-'}
                                  </p>
                                </div>
                                <div className="rounded-lg bg-gray-50 p-3">
                                  <p className="text-xs text-gray-500">Ketua Kelas</p>
                                  <p className="font-medium text-gray-900">
                                    {selectedDeletedHistory.snapshot.kelas_struktur[0]?.ketua_siswa_nama || selectedDeletedHistory.snapshot.kelas_struktur[0]?.ketua_siswa_id || '-'}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-gray-500">Belum ada struktur yang tersimpan.</p>
                            )}
                          </div>

                          <div className="rounded-xl border border-gray-200 overflow-hidden">
                            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                              <p className="font-semibold text-gray-900">Snapshot Jadwal</p>
                              <span className="text-xs text-gray-500">{selectedDeletedHistory.snapshot?.jadwal?.length || 0} baris</span>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-white">
                                  <tr>
                                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Hari</th>
                                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Jam</th>
                                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Mapel</th>
                                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Guru</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {(selectedDeletedHistory.snapshot?.jadwal || []).map((row) => (
                                    <tr key={row.id || `${row.hari}-${row.jam_mulai}-${row.mapel}`}>
                                      <td className="px-4 py-3 text-gray-900">{row.hari || '-'}</td>
                                      <td className="px-4 py-3 text-gray-700">{toTimeHHMM(row.jam_mulai)} - {toTimeHHMM(row.jam_selesai)}</td>
                                      <td className="px-4 py-3 text-gray-700">{row.mapel || '-'}</td>
                                      <td className="px-4 py-3 text-gray-700">{row.guru_nama || row.guru_id || '-'}</td>
                                    </tr>
                                  ))}
                                  {!selectedDeletedHistory.snapshot?.jadwal?.length && (
                                    <tr>
                                      <td colSpan="4" className="px-4 py-8 text-center text-gray-500">
                                        Tidak ada jadwal dalam snapshot ini.
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="py-16 text-center text-gray-500">
                          <p>Pilih riwayat untuk melihat detail kelas.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {promotionModalOpen && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                  <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <span className="p-2 bg-indigo-100 text-indigo-700 rounded-lg">⬆️</span>
                        <span>Pengecualian Kenaikan Kelas</span>
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Pilih siswa yang tidak naik kelas. Rollover otomatis tetap dijalankan dari Pengaturan Akademik.
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
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                      <p className="text-sm font-semibold text-indigo-900">
                        Rollover target: {academicPeriod.tahunAjaran} → {nextAcademicPeriod.tahunAjaran}
                      </p>
                      <p className="mt-1 text-xs text-indigo-700">
                        Siswa yang dipilih akan tetap di kelas asal. Siswa lain tetap naik otomatis saat tahun ajaran baru diaktifkan.
                      </p>
                    </div>

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
                            Siswa terlihat: <span className="font-semibold">{promotionStudentsLoading ? '...' : promotionCandidateSiswa.length}</span>
                            {' '}• Tidak naik: <span className="font-semibold">{promotionSelectedIds.length}</span>
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
                        <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
                          {promotionStudentsLoading ? (
                            <div className="px-4 py-8 text-center text-sm text-gray-500">
                              Memuat daftar siswa...
                            </div>
                          ) : promotionCandidateSiswa.length ? (
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">Catatan pengecualian</label>
                        <textarea
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 resize-none"
                          rows={3}
                          value={promotionRetainReason}
                          onChange={(event) => setPromotionRetainReason(event.target.value)}
                          placeholder="Contoh: Tidak naik kelas berdasarkan keputusan rapat kenaikan kelas."
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Catatan ini hanya untuk audit rollover. Data tugas, quiz, nilai, dan absensi lama tetap tersimpan.
                        </p>
                      </div>
                    </div>
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
                        promotionStudentsLoading
                      }
                    >
                      {promotionLoading ? 'Menyimpan...' : 'Simpan Pengecualian'}
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

