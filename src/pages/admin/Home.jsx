import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { apiClient } from '../../lib/api/client'
import { useLocalCache } from '../../hooks/useLocalCache'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { resolveAcademicPeriod } from '../../utils/academicPeriod'
import AcademicPeriodArchiveFilter from '../../components/AcademicPeriodArchiveFilter'
import useActiveAcademicPeriod from '../../hooks/useActiveAcademicPeriod'
import { queryClient, queryKeys } from '../../lib/queryClient'
import { adminDashboardService } from '../../services/adminDashboardService'
import { announcementService } from '../../services/announcementService'
import { teacherService } from '../../services/teacherService'
import { extracurricularService } from '../../services/extracurricularService'
import { List } from 'react-window'

/* ===== Utils ===== */
const slug = (s = '') =>
  s
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)

const confirmDelete = (msg = 'Yakin mau dihapus?') => window.confirm(msg)
const HARI_OPTS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const USE_ANNOUNCEMENTS_API_V2 = import.meta.env.VITE_USE_ANNOUNCEMENTS_API_V2 === 'true'
const USE_EXTRACURRICULARS_API_V2 = import.meta.env.VITE_USE_EXTRACURRICULAR_API_V2 === 'true'

// Helper parse/format hari ekskul
const parseEskulDays = (hariText = '') => {
  if (!hariText) return []
  return hariText
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)
}

const formatEskulDays = (hariArray = []) => {
  if (!Array.isArray(hariArray) || hariArray.length === 0) return ''
  return hariArray.join(', ')
}

const toDateTimeLocalValue = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const pad = (n) => String(n).padStart(2, '0')
  const yyyy = date.getFullYear()
  const mm = pad(date.getMonth() + 1)
  const dd = pad(date.getDate())
  const hh = pad(date.getHours())
  const mi = pad(date.getMinutes())
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`
}

const toIsoFromDateTimeLocal = (value) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

const DEFAULT_MAX_ESKUL_PER_SISWA = 3
const normalizeEskulLimit = (value) => Math.max(1, Math.min(99, Number.parseInt(value, 10) || DEFAULT_MAX_ESKUL_PER_SISWA))

function EskulMemberRow({
  index,
  style,
  ariaAttributes,
  items,
  isArchive,
  onRemove
}) {
  const a = items[index] || {}

  return (
    <div style={style} {...ariaAttributes} className="pr-2 pb-2">
      <div className="flex h-full flex-col gap-4 rounded-xl border-2 border-gray-200 p-4 transition-all duration-200 hover:border-emerald-300 hover:bg-emerald-50 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="hidden rounded-lg bg-emerald-100 p-3 text-emerald-600 sm:block">
            👤
          </div>
          <div>
            <div className="max-w-[200px] truncate font-semibold text-gray-900 sm:max-w-[400px]">
              {a.nama || '-'}
            </div>
            <div className="mt-1 text-sm text-gray-500">
              Kelas: <span className="font-medium">{a.kelas || '-'}</span>
              <span className="mx-1">•</span>
              Angkatan: <span className="font-medium">{a.angkatan || '-'}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
                ✅ Hadir:
                <span className="ml-1">{a.hadirCount || 0}</span>
              </span>
              <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">
                📝 Izin:
                <span className="ml-1">{a.izinCount || 0}</span>
              </span>
            </div>
          </div>
        </div>
        <button
          className="rounded-lg bg-red-50 px-4 py-2 text-xs font-semibold text-red-600 transition-all duration-200 hover:bg-red-100 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onRemove(a.id)}
          disabled={isArchive || !a.id}
        >
          🗑️ Hapus
        </button>
      </div>
    </div>
  )
}

const getPeriodEndDateTime = (period) => {
  const raw = period?.endsAt || period?.periodeSelesai || ''
  if (!raw) return null
  const date = new Date(`${raw}T23:59:59`)
  return Number.isNaN(date.getTime()) ? null : date
}

const getPeriodEndDateTimeLocal = (period) => {
  const end = getPeriodEndDateTime(period)
  return end ? toDateTimeLocalValue(end.toISOString()) : ''
}

const clampDateToPeriodEnd = (date, period) => {
  const periodEnd = getPeriodEndDateTime(period)
  if (periodEnd && date > periodEnd) return periodEnd
  return date
}

const isAfterPeriodEnd = (isoValue, period) => {
  if (!isoValue) return false
  const date = new Date(isoValue)
  const periodEnd = getPeriodEndDateTime(period)
  if (Number.isNaN(date.getTime()) || !periodEnd) return false
  return date > periodEnd
}

const applyAcademicSemesterFilter = (query, period) => {
  let next = query
  if (period?.tahunAjaran) next = next.eq('tahun_ajaran', period.tahunAjaran)
  if (period?.semester) next = next.eq('semester', period.semester)
  return next
}

const formatDateTimeLabel = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const defaultRegistrationDeadlineLocal = (days = 7, period = null) => {
  const date = new Date()
  date.setSeconds(0, 0)
  date.setDate(date.getDate() + Number(days || 0))
  return toDateTimeLocalValue(clampDateToPeriodEnd(date, period).toISOString())
}

const buildEskulId = (nama, period) => {
  const year = String(period?.tahunAjaran || '').replace(/\//g, '-')
  const semester = String(period?.semester || '').toLowerCase()
  const unique = Date.now().toString(36).slice(-6)
  return [slug(nama), slug(year), slug(semester), unique].filter(Boolean).join('-')
}

// Komponen Stat Card
const StatCard = React.memo(({ label, value, icon, color = 'blue' }) => {
  const colorMap = {
    blue: { bg: 'from-blue-500 to-blue-600', light: 'bg-blue-50', text: 'text-blue-600' },
    green: { bg: 'from-emerald-500 to-emerald-600', light: 'bg-emerald-50', text: 'text-emerald-600' },
    purple: { bg: 'from-violet-500 to-violet-600', light: 'bg-violet-50', text: 'text-violet-600' },
    orange: { bg: 'from-orange-500 to-orange-600', light: 'bg-orange-50', text: 'text-orange-600' },
    red: { bg: 'from-rose-500 to-rose-600', light: 'bg-rose-50', text: 'text-rose-600' },
    indigo: { bg: 'from-indigo-500 to-indigo-600', light: 'bg-indigo-50', text: 'text-indigo-600' },
  }
  const c = colorMap[color] || colorMap.blue

  return (
    <div className="group bg-white rounded-2xl border border-slate-100 shadow-card p-5 transition-all duration-200 hover:shadow-card-hover hover:-translate-y-0.5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-normal">{label}</p>
        {icon && (
          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${c.bg} flex items-center justify-center text-white text-base shadow-sm`}>
            {icon}
          </div>
        )}
      </div>
      <p className="text-3xl font-semibold text-slate-900 tabular-nums">{value}</p>
      <div className="mt-3 h-0.5 rounded-full bg-gradient-to-r from-transparent via-slate-100 to-transparent" />
    </div>
  )
})

StatCard.displayName = 'StatCard'

// ===================================================================
//    Halaman Home Admin (Dashboard, Pengumuman & Ekstrakurikuler)
// ===================================================================
export default function AHome() {
  const { pushToast } = useUIStore()
  const { user, profile } = useAuthStore()
  const {
    activeAcademicPeriod: activeSchoolPeriod,
    activeSemesterPeriod: eskulDataPeriod,
    periodFilter: eskulPeriodFilter,
    academicYearOptions,
    semesterOptions,
    isViewingArchivePeriod,
    setAcademicYear,
    setSemester,
    resetToActivePeriod
  } = useActiveAcademicPeriod({
    storageKey: 'edusmart.admin.eskul.periodFilter'
  })

  /* --- Statistics --- */
  const [stats, setStats, hasStatsCache] = useLocalCache('admin_dashboard_stats', {
    siswa: 0,
    guru: 0,
    admin: 0,
    kelas: 0,
    absensi: 0,
    pengumuman: 0,
    eskul: 0
  })

  const [isLoading, setIsLoading] = useState(false)
  const [isDashboardRefreshing, setIsDashboardRefreshing] = useState(false)
  const [settingsId, setSettingsId] = useState(null)
  const [maxEskulPerSiswa, setMaxEskulPerSiswa] = useState(DEFAULT_MAX_ESKUL_PER_SISWA)
  const [savingMaxEskul, setSavingMaxEskul] = useState(false)
  const [activeEskulPeriod, setActiveEskulPeriod] = useState(activeSchoolPeriod)
  const hasLoadedInitialDataRef = useRef(false)

  useEffect(() => {
    setActiveEskulPeriod(activeSchoolPeriod)
  }, [activeSchoolPeriod])

  const loadCurrentAcademicPeriod = useCallback(async ({ force = false } = {}) => {
    const dashboard = await queryClient.fetchQuery({
      queryKey: queryKeys.admin.activeAcademicPeriodSettings(),
      queryFn: async () => {
        const response = await adminDashboardService.getDashboard()
        return response.data || {}
      },
      staleTime: force ? 0 : 60 * 1000
    })

    const settings = dashboard?.settings || {}
    const period = resolveAcademicPeriod(dashboard?.academic_period || settings)
    setSettingsId(settings?.id || null)
    setMaxEskulPerSiswa(normalizeEskulLimit(settings?.max_ekskul_per_siswa))
    setActiveEskulPeriod(period)
    return period
  }, [])

  // Gunakan useCallback untuk fungsi yang dipanggil di useEffect
  const loadAllData = useCallback(async ({ silent = false } = {}) => {
    const shouldBlock = !silent && !hasStatsCache
    setIsLoading(shouldBlock)
    setIsDashboardRefreshing(!shouldBlock)
    try {
      const summaryParams = activeSchoolPeriod?.tahunAjaran
        ? { tahun_ajaran: activeSchoolPeriod.tahunAjaran }
        : {}
      const [bootstrap, teacherRows] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: queryKeys.admin.dashboard(summaryParams),
          queryFn: async () => {
            const response = await adminDashboardService.getDashboard(summaryParams)
            return response.data || {}
          },
          staleTime: silent ? 60 * 1000 : 15 * 1000
        }),
        queryClient.fetchQuery({
          queryKey: queryKeys.admin.teacherOptions({ ...summaryParams, status: 'active' }),
          queryFn: () => teacherService.listAllTeacherOptions({ status: 'active' }),
          staleTime: 60 * 1000
        })
      ])

      if (bootstrap?.settings) {
        setSettingsId(bootstrap.settings?.id || null)
        setMaxEskulPerSiswa(normalizeEskulLimit(bootstrap.settings?.max_ekskul_per_siswa))
      }
      if (bootstrap?.academic_period?.tahun_ajaran) {
        setActiveEskulPeriod(resolveAcademicPeriod(bootstrap.academic_period))
      }

      const summary = bootstrap?.summary || bootstrap || {}
      const pengumumanRows = bootstrap?.announcements || []

      setStats({
        siswa: summary.siswa || 0,
        guru: summary.guru || 0,
        admin: summary.admin || 0,
        kelas: summary.kelas || 0,
        absensi: summary.absensi || 0,
        pengumuman: summary.pengumuman || pengumumanRows.length,
        eskul: summary.eskul || 0
      })

      setGuruList(
        teacherRows.map((guru) => ({
          id: guru.id,
          name: `${guru.nama || 'Tanpa Nama'}${guru.email ? ` (${guru.email})` : ''}`
        }))
      )

      setPengumumanList(pengumumanRows)

    } catch (error) {
      pushToast('error', error?.message ? `Gagal memuat data awal: ${error.message}` : 'Gagal memuat data awal')
    } finally {
      setIsLoading(false)
      setIsDashboardRefreshing(false)
    }
  }, [activeSchoolPeriod, hasStatsCache, pushToast])

  useEffect(() => {
    if (hasLoadedInitialDataRef.current) return
    hasLoadedInitialDataRef.current = true
    loadAllData({ silent: hasStatsCache })
  }, [hasStatsCache, loadAllData])

  const loadStatistics = useCallback(async () => {
    try {
      const params = activeSchoolPeriod?.tahunAjaran ? { tahun_ajaran: activeSchoolPeriod.tahunAjaran } : {}
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.admin.dashboard(params),
        queryFn: async () => {
          const response = await adminDashboardService.getDashboard(params)
          return response.data?.summary || {}
        },
        staleTime: 15 * 1000
      })

      setStats({
        siswa: data.siswa || 0,
        guru: data.guru || 0,
        admin: data.admin || 0,
        kelas: data.kelas || 0,
        absensi: data.absensi || 0,
        pengumuman: data.pengumuman || 0,
        eskul: data.eskul || 0
      })
    } catch (error) {
      pushToast('error', 'Gagal memuat statistik')
    }
  }, [activeSchoolPeriod?.tahunAjaran, pushToast])

  useEffect(() => {
    const channel = supabase
      .channel('admin_home_period')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => {
        void loadCurrentAcademicPeriod({ force: true })
        void loadStatistics()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadCurrentAcademicPeriod, loadStatistics])

  // LIVE RFID SYNC: Auto-poll statistics every 60 seconds silently
  useEffect(() => {
    const interval = setInterval(() => {
      loadStatistics()
    }, 60000)
    return () => clearInterval(interval)
  }, [loadStatistics])


  /* --- Data Umum (Guru & Siswa) --- */
  const [guruList, setGuruList] = useLocalCache('admin_dashboard_guruList', [])
  const [siswaList, setSiswaList] = useLocalCache('admin_dashboard_siswaList', [])
  const [studentOptionsLoading, setStudentOptionsLoading] = useState(false)
  const [studentOptionsLoaded, setStudentOptionsLoaded] = useState(false)

  useEffect(() => {
    setStudentOptionsLoaded(false)
    setSiswaList([])
  }, [eskulDataPeriod?.tahunAjaran, setSiswaList])

  const mergeSiswaOptions = useCallback((rows = []) => {
    if (!Array.isArray(rows) || rows.length === 0) return

    setSiswaList((prev) => {
      const map = new Map(prev.map((item) => [item.uid, item]))
      rows.forEach((row) => {
        const uid = row.uid || row.id
        if (!uid) return
        map.set(uid, {
          uid,
          nama: row.nama || row.email || 'Tanpa Nama',
          kelas: row.kelas || '',
          email: row.email || '',
          angkatan: row.angkatan || ''
        })
      })
      return Array.from(map.values()).sort(
        (a, b) =>
          (a.kelas || '').localeCompare(b.kelas || '', 'id') ||
          (a.nama || '').localeCompare(b.nama || '', 'id')
      )
    })
  }, [])

  const loadStudentOptions = useCallback(async ({ force = false, all = false, kelas = '', q = '' } = {}) => {
    setStudentOptionsLoading(true)
    try {
      const params = {
        per_page: all ? 10000 : (q ? 50 : 100),
        status: 'active'
      }
      if (eskulDataPeriod?.tahunAjaran) params.tahun_ajaran = eskulDataPeriod.tahunAjaran
      if (all) params.all = true
      if (kelas) params.kelas = kelas
      if (q) params.q = q

      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.admin.studentOptions(params),
        queryFn: async () => {
          const { data, error } = await supabase.admin.studentOptions(params)
          if (error) throw error
          return data || {}
        },
        staleTime: force ? 0 : 60 * 1000
      })
      if (data?.meta?.has_more !== undefined) {
         setMemberOptionsHasMore(data.meta.has_more)
      }
      const rows = data?.rows || []
      mergeSiswaOptions(rows)
      if (!kelas) setStudentOptionsLoaded(true)
      return rows.map((row) => ({
        uid: row.uid || row.id,
        nama: row.nama || row.email || 'Tanpa Nama',
        kelas: row.kelas || '',
        email: row.email || '',
        angkatan: row.angkatan || ''
      })).filter((row) => row.uid)
    } catch (error) {
      pushToast('error', 'Gagal memuat pilihan siswa')
      return []
    } finally {
      setStudentOptionsLoading(false)
    }
  }, [eskulDataPeriod?.tahunAjaran, mergeSiswaOptions, pushToast])


  // Map cepat: uid → {nama, kelas}
  const siswaMap = useMemo(() => {
    const m = {}
    siswaList.forEach((s) => {
      m[s.uid] = s
    })
    return m
  }, [siswaList])

  /* --- Section 1: Pengumuman --- */
  const [pengumumanList, setPengumumanList] = useLocalCache('admin_dashboard_pengumumanList', [])
  const [pForm, setPForm] = useState({
    judul: '',
    keterangan: '',
    target: 'semua'
  })
  const [pEditId, setPEditId] = useState(null)
  const [loadingPengumuman, setLoadingPengumuman] = useState(false)

  const loadPengumuman = useCallback(async () => {
    try {
      if (USE_ANNOUNCEMENTS_API_V2) {
        const response = await announcementService.listAnnouncements({ per_page: 100 })
        setPengumumanList(response.data || [])
        return
      }

      const { data, error } = await supabase
        .from('pengumuman')
        .select('id,judul,keterangan,target,created_at,updated_at')
        .order('created_at', { ascending: false })

      if (error) throw error
      setPengumumanList(data || [])
    } catch (error) {
      pushToast('error', 'Gagal memuat pengumuman')
    }
  }, [pushToast])

  const simpanPengumuman = useCallback(async (e) => {
    e.preventDefault()
    const { judul, keterangan, target } = pForm
    if (!judul || !keterangan) {
      pushToast('error', 'Judul dan Keterangan wajib diisi.')
      return
    }

    setLoadingPengumuman(true)
    const payload = {
      judul: judul.trim(),
      keterangan: keterangan.trim(),
      target: target || 'semua',
      updated_at: new Date().toISOString()
    }

    try {
      if (pEditId) {
        if (USE_ANNOUNCEMENTS_API_V2) {
          await announcementService.updateAnnouncement(pEditId, payload)
        } else {
          const { error } = await supabase
            .from('pengumuman')
            .update(payload)
            .eq('id', pEditId)

          if (error) throw error
        }
        pushToast('success', 'Pengumuman diperbarui!')
      } else {
        if (USE_ANNOUNCEMENTS_API_V2) {
          await announcementService.storeAnnouncement(payload)
        } else {
          const id = slug(payload.judul) || Date.now().toString()

          const { data: existing } = await supabase
            .from('pengumuman')
            .select('id')
            .eq('id', id)
            .single()

          if (existing) {
            pushToast('error', 'Pengumuman dengan judul ini sudah ada.')
            return
          }

          await apiClient('/api/v2/announcements', { method: 'POST', body: JSON.stringify({
            ...payload,
            id,
            created_at: new Date().toISOString()
          }) })
          const error = null

          if (error) throw error
        }
        pushToast('success', 'Pengumuman disimpan!')
      }
      cancelEditPengumuman()
      await loadPengumuman()
      await loadStatistics()
    } catch (err) {
      pushToast('error', 'Gagal menyimpan pengumuman')
    } finally {
      setLoadingPengumuman(false)
    }
  }, [pForm, pEditId, loadPengumuman, loadStatistics, pushToast])

  const hapusPengumuman = useCallback(async (id) => {
    if (!confirmDelete('Hapus pengumuman ini?')) return

    try {
      if (USE_ANNOUNCEMENTS_API_V2) {
        await announcementService.deleteAnnouncement(id)
      } else {
        const { error } = await supabase
          .from('pengumuman')
          .delete()
          .eq('id', id)

        if (error) throw error
      }
      pushToast('success', 'Pengumuman dihapus!')
      loadPengumuman()
      loadStatistics()
    } catch (error) {
      pushToast('error', 'Gagal menghapus pengumuman')
    }
  }, [loadPengumuman, loadStatistics, pushToast])

  const startEditPengumuman = useCallback((p) => {
    setPEditId(p.id)
    setPForm({
      judul: p.judul,
      keterangan: p.keterangan,
      target: p.target || 'semua'
    })
  }, [])

  const cancelEditPengumuman = useCallback(() => {
    setPEditId(null)
    setPForm({ judul: '', keterangan: '', target: 'semua' })
  }, [])

  /* --- Section 2: Ekstrakurikuler --- */
  const [eskulList, setEskulList] = useLocalCache('admin_dashboard_eskulList', [])
  const [eskulSel, setEskulSel] = useState('')
  const [eskulForm, setEskulForm] = useState({
    nama: '',
    keterangan: '',
    hari: '',
    jam_mulai: '',
    jam_selesai: '',
    pembina_guru_id: '',
    registration_deadline_at: defaultRegistrationDeadlineLocal(7, activeEskulPeriod)
  })
  const [eskulAnggota, setEskulAnggota] = useState([])
  const [eskulAbsensiStats, setEskulAbsensiStats] = useState({})
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false)
  const [addMemberUid, setAddMemberUid] = useState('')
  const [addMemberMode, setAddMemberMode] = useState('single')
  const [memberSearch, setMemberSearch] = useState('')
  const [memberOptionsHasMore, setMemberOptionsHasMore] = useState(false)
  const [addMemberClass, setAddMemberClass] = useState('')
  const [loadingEskul, setLoadingEskul] = useState(false)

  const registrationDeadlineIso = toIsoFromDateTimeLocal(
    eskulForm.registration_deadline_at
  )
  const registrationDeadlineLabel = formatDateTimeLabel(registrationDeadlineIso)
  const registrationDeadlineClosed = registrationDeadlineIso
    ? Date.now() > new Date(registrationDeadlineIso).getTime()
    : false
  const registrationDeadlinePastPeriod = isAfterPeriodEnd(registrationDeadlineIso, activeEskulPeriod)
  const activePeriodEndInput = getPeriodEndDateTimeLocal(activeEskulPeriod)
  const addMemberLocked = isViewingArchivePeriod || !registrationDeadlineIso || registrationDeadlineClosed || registrationDeadlinePastPeriod

  const loadEskulList = useCallback(async () => {
    try {
      if (USE_EXTRACURRICULARS_API_V2) {
        const data = await extracurricularService.getExtracurriculars()
        const rows = data || []
        setEskulList(rows)
        setEskulSel((current) => (
          current && rows.some((item) => item.id === current) ? current : ''
        ))
        return
      }

      let query = supabase
        .from('ekskul')
        .select('id,nama,keterangan,hari,jam_mulai,jam_selesai,pembina_guru_id,registration_deadline_at,created_at,updated_at,tahun_ajaran,semester')
        .order('nama')
      query = applyAcademicSemesterFilter(query, eskulDataPeriod)

      let { data, error } = await query
      if (error && /tahun_ajaran|semester/i.test(error.message || '')) {
        ; ({ data, error } = await supabase
          .from('ekskul')
          .select('id,nama,keterangan,hari,jam_mulai,jam_selesai,pembina_guru_id,registration_deadline_at,created_at,updated_at')
          .order('nama'))
      }

      if (error) throw error
      const rows = data || []
      setEskulList(rows)
      setEskulSel((current) => (
        current && rows.some((item) => item.id === current) ? current : ''
      ))
    } catch (error) {
      pushToast('error', 'Gagal memuat daftar eskul')
    }
  }, [eskulDataPeriod, pushToast])

  const loadEskulDetail = useCallback(async () => {
    if (!eskulSel) return

    const applyDetailForm = (data = {}) => {
      setEskulForm({
        nama: data.nama || '',
        keterangan: data.keterangan || '',
        hari: data.hari || '',
        jam_mulai: data.jam_mulai || '',
        jam_selesai: data.jam_selesai || '',
        pembina_guru_id: data.pembina_guru_id || '',
        registration_deadline_at: toDateTimeLocalValue(data.registration_deadline_at)
      })
    }

    const selectedFromList = eskulList.find((item) => item.id === eskulSel)
    if (selectedFromList) {
      applyDetailForm(selectedFromList)
      return
    }

    try {
      if (USE_EXTRACURRICULARS_API_V2) {
        const data = await extracurricularService.getExtracurricularById(eskulSel)
        if (data && data.data) {
          applyDetailForm(data.data)
        } else {
          applyDetailForm(data)
        }
        return
      }

      let detailQuery = supabase
        .from('ekskul')
        .select('id,nama,keterangan,hari,jam_mulai,jam_selesai,pembina_guru_id,registration_deadline_at,tahun_ajaran,semester')
        .eq('id', eskulSel)
      detailQuery = applyAcademicSemesterFilter(detailQuery, eskulDataPeriod)

      let { data, error } = await detailQuery
        .order('updated_at', { ascending: false })
        .limit(1)
      if (error && /tahun_ajaran|semester/i.test(error.message || '')) {
        ; ({ data, error } = await supabase
          .from('ekskul')
          .select('id,nama,keterangan,hari,jam_mulai,jam_selesai,pembina_guru_id,registration_deadline_at')
          .eq('id', eskulSel)
          .order('updated_at', { ascending: false })
          .limit(1))
      }

      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      if (row) {
        applyDetailForm(row)
      } else {
        setEskulForm({
          nama: '',
          keterangan: '',
          hari: '',
          jam_mulai: '',
          jam_selesai: '',
          pembina_guru_id: '',
          registration_deadline_at: defaultRegistrationDeadlineLocal(7, activeEskulPeriod)
        })
      }
    } catch (error) {
      pushToast('error', 'Gagal memuat detail eskul')
    }
  }, [activeEskulPeriod, eskulDataPeriod, eskulList, eskulSel, pushToast])

  useEffect(() => {
    loadEskulList()
    setAddMemberUid('')
  }, [loadEskulList])

  
  useEffect(() => {
    if (!isAddMemberModalOpen || addMemberMode !== 'single' || addMemberLocked) return undefined
    const timer = window.setTimeout(() => {
      loadStudentOptions({ q: memberSearch, kelas: addMemberClass })
    }, memberSearch ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [addMemberMode, addMemberLocked, addMemberClass, isAddMemberModalOpen, loadStudentOptions, memberSearch])

  const loadEskulAnggota = useCallback(async () => {
    if (!eskulSel) return

    try {
      const period = eskulDataPeriod

      let anggota = []
      
      if (USE_EXTRACURRICULARS_API_V2) {
        const response = await extracurricularService.getMembers(eskulSel)
        // Format mapping to match old structure
        anggota = (response.data || []).map(m => ({
          id: m.membership_id,
          ekskul_id: eskulSel,
          user_id: m.user_id,
          nama: m.nama,
          kelas: m.kelas,
          angkatan: m.angkatan || '',
          created_at: m.created_at
        }))
        setEskulAnggota(anggota)
        mergeSiswaOptions(anggota.map(a => ({ id: a.user_id, uid: a.user_id, nama: a.nama, kelas: a.kelas })))
      } else {
        let anggotaQuery = supabase
          .from('ekskul_anggota')
          .select('id,ekskul_id,user_id,angkatan,status,created_at,updated_at,tahun_ajaran,semester')
          .eq('ekskul_id', eskulSel)
        anggotaQuery = applyAcademicSemesterFilter(anggotaQuery, period)

        let { data, error } = await anggotaQuery
        if (error && /tahun_ajaran|semester|angkatan/i.test(error.message || '')) {
          ; ({ data, error } = await supabase
            .from('ekskul_anggota')
            .select('id,ekskul_id,user_id,angkatan,status,created_at,updated_at')
            .eq('ekskul_id', eskulSel))
        }

        if (error) throw error
        anggota = data || []
        setEskulAnggota(anggota)
      }

      // Ambil statistik absensi eskul untuk bulan dalam periode akademik aktif.
      const userIds = anggota.map((a) => a.user_id).filter(Boolean)

      if (userIds.length === 0) {
        setEskulAbsensiStats({})
        return
      }

      const { data: memberProfiles, error: memberProfileError } = await supabase
        .from('profiles')
        .select('id,nama,email,kelas,angkatan')
        .eq('role', 'siswa')
        .in('id', userIds)

      if (!memberProfileError && memberProfiles) {
        mergeSiswaOptions(memberProfiles)
      }

      let absQuery = supabase
        .from('absensi_eskul')
        .select('user_id, status')
        .eq('ekskul_id', eskulSel)
        .in('user_id', userIds)
        .in('status', ['Hadir', 'Izin'])
      absQuery = applyAcademicSemesterFilter(absQuery, period)

      let { data: absData, error: absError } = await absQuery
      if (absError && /tahun_ajaran|semester/i.test(absError.message || '')) {
        ; ({ data: absData, error: absError } = await supabase
          .from('absensi_eskul')
          .select('user_id, status')
          .eq('ekskul_id', eskulSel)
          .in('user_id', userIds)
          .in('status', ['Hadir', 'Izin']))
      }

      if (absError) throw absError

      const stats = {}
        ; (absData || []).forEach((row) => {
          const uid = row.user_id
          if (!stats[uid]) {
            stats[uid] = { hadir: 0, izin: 0 }
          }
          if (row.status === 'Hadir') {
            stats[uid].hadir += 1
          } else if (row.status === 'Izin') {
            stats[uid].izin += 1
          }
        })

      setEskulAbsensiStats(stats)
    } catch (error) {
      pushToast('error', 'Gagal memuat data anggota eskul')
    }
  }, [eskulDataPeriod, eskulSel, mergeSiswaOptions, pushToast])

  // Load eskul detail dan anggota ketika eskulSel berubah
  useEffect(() => {
    if (!eskulSel) {
      setEskulForm({
        nama: '',
        keterangan: '',
        hari: '',
        jam_mulai: '',
        jam_selesai: '',
        pembina_guru_id: '',
        registration_deadline_at: defaultRegistrationDeadlineLocal(7, activeEskulPeriod)
      })
      setEskulAnggota([])
      setEskulAbsensiStats({})
      return
    }

    loadEskulDetail()
    loadEskulAnggota()
  }, [activeEskulPeriod, eskulSel, loadEskulDetail, loadEskulAnggota])

  // daftar hari yang sedang dipilih (multi hari)
  const selectedHariValues = useMemo(
    () => parseEskulDays(eskulForm.hari),
    [eskulForm.hari]
  )

  // Gabungkan data anggota dengan data siswa (nama + kelas + statistik hadir/izin)
  const anggotaDisplay = useMemo(() => {
    const rows = eskulAnggota.map((a) => {
      const s = siswaMap[a.user_id] || {}
      const stat = eskulAbsensiStats[a.user_id] || { hadir: 0, izin: 0 }
      return {
        uid: a.user_id,
        id: a.id,
        nama: s.nama || a.user_id,
        kelas: s.kelas || '—',
        angkatan: a.angkatan || s.angkatan || '—',
        hadirCount: stat.hadir,
        izinCount: stat.izin
      }
    })
    return rows.sort(
      (a, b) =>
        (a.kelas || '').localeCompare(b.kelas || '', 'id') ||
        (a.nama || '').localeCompare(b.nama || '', 'id')
      )
  }, [eskulAnggota, siswaMap, eskulAbsensiStats])

  const kelasOptions = useMemo(() => (
    Array.from(new Set(siswaList.map((s) => s.kelas).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'id'))
  ), [siswaList])

  const availableSiswaOptions = useMemo(() => (
    siswaList.filter((s) => !addMemberClass || s.kelas === addMemberClass)
  ), [addMemberClass, siswaList])

  useEffect(() => {
    setAddMemberUid('')
  }, [addMemberClass, addMemberMode])

  // toggle hari (checkbox di dropdown)
  const handleToggleHari = useCallback((hariValue) => {
    setEskulForm((prev) => {
      const current = parseEskulDays(prev.hari)
      const exists = current.includes(hariValue)
      const next = exists
        ? current.filter((h) => h !== hariValue)
        : [...current, hariValue]

      return {
        ...prev,
        hari: formatEskulDays(next)
      }
    })
  }, [])

  const setEskulRegistrationDeadlineByDays = useCallback((days) => {
    const safeDays = Number(days)
    if (!Number.isFinite(safeDays) || safeDays <= 0) return

    const date = new Date()
    date.setSeconds(0, 0)
    date.setDate(date.getDate() + safeDays)

    setEskulForm((prev) => ({
      ...prev,
      registration_deadline_at: toDateTimeLocalValue(clampDateToPeriodEnd(date, activeEskulPeriod).toISOString())
    }))
  }, [activeEskulPeriod])

  const clearEskulRegistrationDeadline = useCallback(() => {
    setEskulForm((prev) => ({
      ...prev,
      registration_deadline_at: defaultRegistrationDeadlineLocal(7, activeEskulPeriod)
    }))
  }, [activeEskulPeriod])

  const saveMaxEskulPerSiswa = useCallback(async () => {
    const nextLimit = normalizeEskulLimit(maxEskulPerSiswa)
    setMaxEskulPerSiswa(nextLimit)

    if (!settingsId) {
      pushToast('error', 'Pengaturan sekolah belum siap. Muat ulang halaman lalu coba lagi.')
      return
    }

    setSavingMaxEskul(true)
    try {
      const { error } = await supabase
        .from('settings')
        .update({
          max_ekskul_per_siswa: nextLimit,
          updated_at: new Date().toISOString()
        })
        .eq('id', settingsId)

      if (error) throw error
      pushToast('success', `Batas ekskul siswa disimpan: maksimal ${nextLimit} ekskul.`)
    } catch (error) {
      pushToast('error', error?.message || 'Gagal menyimpan batas ekskul')
    } finally {
      setSavingMaxEskul(false)
    }
  }, [maxEskulPerSiswa, pushToast, settingsId])

  const simpanEskul = useCallback(async () => {
    if (isViewingArchivePeriod) {
      pushToast('warning', 'Data arsip hanya untuk dilihat. Buat atau ubah ekskul dari periode aktif sekolah.')
      return
    }

    const nama = (eskulForm.nama || '').trim()
    if (!nama) {
      pushToast('error', 'Nama eskul wajib diisi.')
      return
    }

    const registrationDeadlineIso = toIsoFromDateTimeLocal(
      eskulForm.registration_deadline_at
    )
    if (!registrationDeadlineIso) {
      pushToast(
        'error',
        'Batas pendaftaran wajib diisi (contoh: +3 hari atau +7 hari).'
      )
      return
    }

    const deadlineDate = new Date(registrationDeadlineIso)
    if (deadlineDate.getTime() <= Date.now()) {
      pushToast('error', 'Batas pendaftaran harus di masa depan.')
      return
    }

    const period = await loadCurrentAcademicPeriod()
    if (isAfterPeriodEnd(registrationDeadlineIso, period)) {
      pushToast('error', `Batas pendaftaran tidak boleh melewati akhir periode aktif (${formatDateTimeLabel(getPeriodEndDateTime(period)?.toISOString())}).`)
      return
    }

    const duplicateName = eskulList.some((item) => (
      item.id !== eskulSel &&
      String(item.nama || '').trim().toLowerCase() === nama.toLowerCase()
    ))
    if (duplicateName) {
      pushToast('error', 'Eskul dengan nama ini sudah ada pada periode yang dipilih.')
      return
    }

    setLoadingEskul(true)
    const pembinaId = eskulForm.pembina_guru_id || ''

    const payload = {
      nama,
      keterangan: eskulForm.keterangan || '',
      hari: eskulForm.hari || '',
      jam_mulai: eskulForm.jam_mulai || '',
      jam_selesai: eskulForm.jam_selesai || '',
      pembina_guru_id: pembinaId || null,
      registration_deadline_at: registrationDeadlineIso,
      tahun_ajaran: period.tahunAjaran,
      semester: period.semester,
      updated_at: new Date().toISOString()
    }

    try {
      if (USE_EXTRACURRICULARS_API_V2) {
        if (eskulSel) {
          await extracurricularService.updateExtracurricular(eskulSel, payload)
          pushToast('success', 'Eskul diperbarui!')
        } else {
          const res = await extracurricularService.createExtracurricular(payload)
          pushToast('success', 'Eskul disimpan!')
          setEskulSel(res.data?.id || '')
          setEskulForm({
            nama: '',
            keterangan: '',
            hari: '',
            jam_mulai: '',
            jam_selesai: '',
            pembina_guru_id: '',
            registration_deadline_at: defaultRegistrationDeadlineLocal(7, activeEskulPeriod)
          })
        }
      } else {
        if (eskulSel) {
          const { error } = await supabase
            .from('ekskul')
            .update(payload)
            .eq('id', eskulSel)

          if (error) throw error
          pushToast('success', 'Eskul diperbarui!')
        } else {
          const id = buildEskulId(nama, period)

          await apiClient('/api/v2/extracurriculars', { method: 'POST', body: JSON.stringify({
            ...payload,
            id,
            created_at: new Date().toISOString()
          }) })
          const error = null

          if (error) throw error
          pushToast('success', 'Eskul disimpan!')
          setEskulSel(id)
          setEskulForm({
            nama: '',
            keterangan: '',
            hari: '',
            jam_mulai: '',
            jam_selesai: '',
            pembina_guru_id: '',
            registration_deadline_at: defaultRegistrationDeadlineLocal(7, activeEskulPeriod)
          })
        }
      }
      await loadEskulList()
      await loadStatistics()
    } catch (err) {
      pushToast('error', 'Gagal menyimpan eskul')
    } finally {
      setLoadingEskul(false)
    }
  }, [eskulForm, eskulList, eskulSel, isViewingArchivePeriod, loadCurrentAcademicPeriod, loadEskulList, loadStatistics, pushToast])

  const hapusEskul = useCallback(async () => {
    if (!eskulSel) return
    if (isViewingArchivePeriod) {
      pushToast('warning', 'Ekskul arsip tidak bisa dihapus dari filter periode lama.')
      return
    }
    if (
      !confirmDelete(`Hapus eskul "${eskulForm.nama || eskulSel}" beserta anggotanya?`)
    )
      return

    try {
      if (USE_EXTRACURRICULARS_API_V2) {
        await extracurricularService.deleteExtracurricular(eskulSel)
      } else {
        // Hapus anggota periode aktif terlebih dahulu. Arsip periode lain tetap aman
        // pada instalasi lama yang pernah memakai id ekskul sama lintas periode.
        let anggotaDeleteQuery = supabase
          .from('ekskul_anggota')
          .delete()
          .eq('ekskul_id', eskulSel)
        anggotaDeleteQuery = applyAcademicSemesterFilter(anggotaDeleteQuery, activeEskulPeriod)

        const { error: errorAnggota } = await anggotaDeleteQuery

        if (errorAnggota) throw errorAnggota

        // Hapus eskul
        const { error: errorEskul } = await supabase
          .from('ekskul')
          .delete()
          .eq('id', eskulSel)

        if (errorEskul) throw errorEskul
      }

      pushToast('success', 'Eskul berhasil dihapus!')
      setEskulSel('')
      await loadEskulList()
      await loadStatistics()
    } catch (error) {
      pushToast('error', 'Gagal menghapus eskul')
    }
  }, [activeEskulPeriod, eskulSel, eskulForm.nama, isViewingArchivePeriod, loadEskulList, loadStatistics, pushToast])

  const normalizeStudentRows = useCallback((rows = []) => (
    (rows || [])
      .map((row) => ({
        uid: row.uid || row.id,
        nama: row.nama || row.email || 'Tanpa Nama',
        kelas: row.kelas || '',
        email: row.email || '',
        angkatan: row.angkatan || ''
      }))
      .filter((row) => row.uid)
  ), [])

  const tambahAnggotaEskul = useCallback(async () => {
    if (!eskulSel) return

    if (isViewingArchivePeriod) {
      pushToast('warning', 'Anggota hanya bisa ditambahkan pada periode aktif sekolah.')
      return
    }

    if (!registrationDeadlineIso || registrationDeadlineClosed || registrationDeadlinePastPeriod) {
      pushToast('warning', 'Pendaftaran ekskul sudah ditutup. Anggota baru tidak bisa ditambahkan.')
      return
    }

    if (addMemberMode === 'single' && !addMemberUid) {
      pushToast('warning', 'Pilih siswa terlebih dahulu.')
      return
    }

    if (addMemberMode === 'class' && !addMemberClass) {
      pushToast('warning', 'Pilih kelas terlebih dahulu.')
      return
    }

    try {
      const period = await loadCurrentAcademicPeriod()
      let selectedStudents = []

      if (addMemberMode === 'single') {
        selectedStudents = normalizeStudentRows([siswaMap[addMemberUid] || siswaList.find((item) => item.uid === addMemberUid) || { uid: addMemberUid }])
      } else if (addMemberMode === 'class') {
        selectedStudents = await loadStudentOptions({ force: true, all: true, kelas: addMemberClass })
      } else {
        selectedStudents = await loadStudentOptions({ force: true, all: true })
      }

      selectedStudents = normalizeStudentRows(selectedStudents)
      if (selectedStudents.length === 0) {
        pushToast('warning', 'Tidak ada siswa aktif yang bisa ditambahkan.')
        return
      }

      const existingMemberUids = new Set(eskulAnggota.map((item) => item.user_id).filter(Boolean))
      const targetStudents = selectedStudents.filter((student) => !existingMemberUids.has(student.uid))

      if (targetStudents.length === 0) {
        pushToast('warning', 'Semua siswa yang dipilih sudah menjadi anggota ekskul pada periode aktif.')
        setAddMemberUid('')
        return
      }

      if (USE_EXTRACURRICULARS_API_V2) {
        let successCount = 0
        let errorMessages = []
        
        for (const student of targetStudents) {
          try {
            await extracurricularService.joinExtracurricular(eskulSel, student.uid)
            successCount++
          } catch (err) {
            errorMessages.push(`${student.nama}: ${err?.response?.data?.error?.message || err.message}`)
          }
        }
        
        if (errorMessages.length > 0) {
          if (successCount === 0) {
            throw new Error(`Gagal menambahkan anggota:\n${errorMessages[0]}`)
          } else {
            pushToast('warning', `Beberapa gagal ditambahkan:\n${errorMessages[0]}`)
          }
        }
        
        pushToast('success', `${successCount} anggota berhasil ditambahkan.`)
        setAddMemberUid('')
        loadEskulAnggota()
        return
      }

      let existingQuery = supabase
        .from('ekskul_anggota')
        .select('user_id')
        .eq('ekskul_id', eskulSel)
        .in('user_id', targetStudents.map((student) => student.uid))
      existingQuery = applyAcademicSemesterFilter(existingQuery, period)

      let { data: existing, error: existingError } = await existingQuery
      if (existingError && /tahun_ajaran|semester/i.test(existingError.message || '')) {
        ; ({ data: existing, error: existingError } = await supabase
          .from('ekskul_anggota')
          .select('user_id')
          .eq('ekskul_id', eskulSel)
          .in('user_id', targetStudents.map((student) => student.uid)))
      }
      if (existingError) throw existingError

      const existingFromServer = new Set((existing || []).map((item) => item.user_id).filter(Boolean))
      const rowsToInsert = targetStudents.filter((student) => !existingFromServer.has(student.uid))

      if (rowsToInsert.length === 0) {
        pushToast('warning', 'Semua siswa yang dipilih sudah menjadi anggota ekskul pada periode aktif.')
        return
      }

      const insertPayload = rowsToInsert.map((student) => ({
        ekskul_id: eskulSel,
        user_id: student.uid,
        tahun_ajaran: period.tahunAjaran,
        semester: period.semester,
        angkatan: student.angkatan || null,
        created_at: new Date().toISOString()
      }))

      await apiClient('/api/v2/extracurriculars/members', { method: 'POST', body: JSON.stringify(insertPayload) });
      let error = null
      if (error && /tahun_ajaran|semester|angkatan/i.test(error.message || '')) {
        const legacyPayload = insertPayload.map(({ tahun_ajaran, semester, angkatan, ...row }) => row)
        await apiClient('/api/v2/extracurriculars/members', { method: 'POST', body: JSON.stringify(legacyPayload) }); error = null
      }

      if (error) throw error
      pushToast('success', `${rowsToInsert.length} anggota berhasil ditambahkan.`)
      setAddMemberUid('')
      loadEskulAnggota()
    } catch (error) {
      pushToast('error', error?.message || 'Gagal menambah anggota')
    }
  }, [
    addMemberClass,
    addMemberMode,
    addMemberUid,
    eskulAnggota,
    eskulSel,
    isViewingArchivePeriod,
    loadCurrentAcademicPeriod,
    loadEskulAnggota,
    loadStudentOptions,
    normalizeStudentRows,
    pushToast,
    registrationDeadlineClosed,
    registrationDeadlineIso,
    registrationDeadlinePastPeriod,
    siswaList,
    siswaMap
  ])

  const hapusAnggotaEskul = useCallback(async (anggotaId) => {
    if (!eskulSel) return
    if (isViewingArchivePeriod) {
      pushToast('warning', 'Anggota periode arsip tidak bisa dihapus dari halaman ini.')
      return
    }
    if (!confirmDelete('Hapus anggota ini dari eskul?')) return

    try {
      if (USE_EXTRACURRICULARS_API_V2) {
        // Cari user_id dari list anggota yang ada berdasarkan membership_id (anggotaId)
        const member = eskulAnggota.find(a => a.id === anggotaId)
        if (!member) throw new Error("Anggota tidak ditemukan")
        await extracurricularService.leaveExtracurricular(eskulSel, member.user_id)
      } else {
        const { error } = await supabase
          .from('ekskul_anggota')
          .delete()
          .eq('id', anggotaId)

        if (error) throw error
      }
      pushToast('success', 'Anggota berhasil dihapus!')
      loadEskulAnggota()
    } catch (error) {
      pushToast('error', 'Gagal menghapus anggota')
    }
  }, [eskulSel, isViewingArchivePeriod, loadEskulAnggota, pushToast])

  return (
    <div className="page-wrapper">
      <div className="w-full space-y-6">
        {/* ── Header ── */}
        <div className="page-title-card">
          <div className="page-title-layout">
            <div className="page-title-main">
              <div className="page-title-icon bg-blue-100 text-blue-600">
                📊
              </div>
              <div>
                <h1 className="page-title-heading">Dashboard Admin</h1>
                <p className="page-title-description">Kelola data sekolah, pengumuman, dan ekstrakurikuler</p>
              </div>
            </div>
            {(isLoading || isDashboardRefreshing) && (
              <span className="inline-flex items-center gap-2 self-start rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 sm:self-center">
                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                {hasStatsCache ? 'Memperbarui data...' : 'Menyiapkan data...'}
              </span>
            )}
          </div>
        </div>

        {/* --- STATISTICS --- */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard label="Total Siswa" value={stats.siswa} icon="👨‍🎓" color="blue" />
          <StatCard label="Total Guru" value={stats.guru} icon="👨‍🏫" color="green" />
          <StatCard label="Kelas" value={stats.kelas} icon="🏫" color="purple" />
          <StatCard label="Absensi" value={stats.absensi} icon="📊" color="orange" />
          <StatCard label="Pengumuman" value={stats.pengumuman} icon="📢" color="red" />
          <StatCard label="Eskul" value={stats.eskul} icon="⚽" color="indigo" />
        </div>

        {/* --- FORM PENGUMUMAN & ESKUL --- */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          {/* === KOLOM PENGUMUMAN === */}
          <div className="space-y-5">
            {/* --- CARD FORM PENGUMUMAN --- */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-card overflow-hidden">
              <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center text-white text-base">📢</div>
                  <div>
                    <h2 className="text-base font-semibold text-white">Kelola Pengumuman</h2>
                    <p className="text-brand-200 text-xs">Untuk guru & siswa</p>
                  </div>
                </div>
              </div>

              <div className="p-5">
                <form className="space-y-4" onSubmit={simpanPengumuman}>
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">Judul Pengumuman</label>
                      <input
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all duration-200 bg-slate-50 placeholder-slate-400"
                        placeholder="Cth: Libur Nasional, Rapat Guru"
                        value={pForm.judul}
                        onChange={(e) =>
                          setPForm((f) => ({ ...f, judul: e.target.value }))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">Keterangan / Isi</label>
                      <textarea
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 min-h-[100px] transition-all duration-200 bg-slate-50 placeholder-slate-400 resize-none"
                        placeholder="Isi pengumuman..."
                        value={pForm.keterangan}
                        onChange={(e) =>
                          setPForm((f) => ({ ...f, keterangan: e.target.value }))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">Tampilkan ke</label>
                      <select
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all duration-200 bg-slate-50"
                        value={pForm.target}
                        onChange={(e) =>
                          setPForm((f) => ({ ...f, target: e.target.value }))
                        }
                      >
                        <option value="semua">Semua (Guru & Siswa)</option>
                        <option value="siswa">Siswa Saja</option>
                        <option value="guru">Guru Saja</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                    {pEditId && (
                      <button type="button"
                        className="px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all duration-200"
                        onClick={cancelEditPengumuman}>
                        Batal
                      </button>
                    )}
                    <button type="submit"
                      className="px-5 py-2 text-sm font-semibold text-white bg-brand-600 rounded-xl hover:bg-brand-700 transition-all duration-200 shadow-brand-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      disabled={loadingPengumuman}>
                      {loadingPengumuman ? (
                        <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Menyimpan...</>
                      ) : pEditId ? 'Simpan Perubahan' : 'Tambah Pengumuman'}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* --- CARD DAFTAR PENGUMUMAN --- */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-card overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">📋</span>
                  <h3 className="text-sm font-semibold text-slate-800">Daftar Pengumuman</h3>
                  <span className="text-xs text-slate-400">({pengumumanList.length})</span>
                </div>
              </div>

              <div className="p-4">
                <div className="space-y-2.5 max-h-80 overflow-y-auto">
                  {pengumumanList.map((p, index) => (
                    <div key={p.id}
                      className="flex items-start gap-3 p-3.5 border border-slate-100 rounded-xl hover:border-brand-200 hover:bg-brand-50/30 transition-all duration-200 group">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm text-slate-800 group-hover:text-brand-700 transition-colors truncate">{p.judul}</span>
                          {index === 0 && <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full flex-shrink-0">BARU</span>}
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-1 mb-1.5">{p.keterangan}</p>
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className={`px-2 py-0.5 rounded-full font-semibold ${p.target === 'siswa' ? 'bg-orange-100 text-orange-700' : p.target === 'guru' ? 'bg-purple-100 text-purple-700' : 'bg-brand-100 text-brand-700'}`}>{p.target || 'semua'}</span>
                          <span className="text-slate-400">{p.created_at ? new Date(p.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}</span>
                        </div>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button className="px-3 py-1.5 text-xs font-semibold text-brand-600 bg-brand-50 rounded-lg hover:bg-brand-100 transition-colors" onClick={() => startEditPengumuman(p)}>Edit</button>
                        <button className="px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors" onClick={() => hapusPengumuman(p.id)}>Hapus</button>
                      </div>
                    </div>
                  ))}
                  {pengumumanList.length === 0 && (
                    <div className="text-center py-10">
                      <div className="text-4xl mb-2 opacity-30">📢</div>
                      <p className="text-sm text-slate-500">Belum ada pengumuman</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* === KOLOM EKSTRAKURIKULER === */}
          <div className="space-y-5">
            {/* Form utama eskul */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-card overflow-hidden">
              <div className="bg-gradient-to-r from-orange-500 to-amber-500 px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center text-white text-base">⚽</div>
                  <div>
                    <h2 className="text-base font-semibold text-white">Kelola Ekstrakurikuler</h2>
                    <p className="text-orange-100 text-xs">{eskulList.length} eskul terdaftar</p>
                  </div>
                </div>
              </div>

              <div className="p-6">
                <AcademicPeriodArchiveFilter
                  activeAcademicPeriod={activeSchoolPeriod}
                  periodFilter={eskulPeriodFilter}
                  academicYearOptions={academicYearOptions}
                  semesterOptions={semesterOptions}
                  setAcademicYear={setAcademicYear}
                  setSemester={setSemester}
                  resetToActivePeriod={resetToActivePeriod}
                  title="Periode Ekskul"
                  compact
                  className="mb-5"
                />

                {isViewingArchivePeriod && (
                  <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                    Mode arsip aktif. Data ekskul periode lama tetap tersimpan, tetapi pembuatan, perubahan, hapus, dan tambah anggota hanya dibuka pada periode aktif.
                  </div>
                )}

                <div className="mb-6 rounded-2xl border border-orange-100 bg-gradient-to-r from-orange-50 to-amber-50 p-4">
                  <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-normal text-orange-700">Aturan Pendaftaran</p>
                      <h3 className="mt-1 text-base font-semibold text-slate-900">Batas Ekstrakurikuler per Siswa</h3>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={maxEskulPerSiswa}
                        onChange={(event) => setMaxEskulPerSiswa(event.target.value)}
                        className="h-12 w-full rounded-xl border-2 border-orange-200 bg-white px-4 text-sm font-medium text-slate-900 focus:border-orange-400 focus:ring-2 focus:ring-orange-200 sm:w-28"
                      />
                      <button
                        type="button"
                        onClick={saveMaxEskulPerSiswa}
                        disabled={savingMaxEskul}
                        className="h-12 rounded-xl bg-orange-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingMaxEskul ? 'Menyimpan...' : 'Simpan'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 mb-6 lg:grid-cols-[1fr_auto] lg:items-end">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-orange-500 rounded-full" />
                        Pilih Eskul
                      </span>
                    </label>
                    <select
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all duration-200"
                      value={eskulSel}
                      onChange={(e) => setEskulSel(e.target.value)}
                    >
                      <option value="">— Buat Eskul Baru —</option>
                      {eskulList.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.nama}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    {eskulSel && (
                      <button
                        className="px-6 py-3 text-sm font-semibold text-red-600 bg-red-50 border-2 border-red-200 rounded-xl hover:bg-red-100 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-all duration-200 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={hapusEskul}
                        disabled={isViewingArchivePeriod}
                      >
                        🗑️ Hapus
                      </button>
                    )}
                    <button
                      className="px-6 py-3 text-sm font-semibold text-white bg-gradient-to-r from-orange-600 to-amber-700 rounded-xl hover:from-orange-700 hover:to-amber-800 focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 transition-all duration-200 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={simpanEskul}
                      disabled={loadingEskul || isViewingArchivePeriod}
                    >
                      {loadingEskul ? (
                        <span className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Menyimpan...
                        </span>
                      ) : eskulSel ? (
                        '💾 Simpan Perubahan'
                      ) : (
                        '✨ Tambah Eskul Baru'
                      )}
                    </button>
                  </div>
                </div>

                {/* Form detail eskul */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 md:gap-x-10 items-start">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-blue-500 rounded-full" />
                        Nama Eskul
                      </span>
                    </label>
                    <input
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                      placeholder="cth: Pramuka, Paskibra"
                      value={eskulForm.nama}
                      onChange={(e) =>
                        setEskulForm((f) => ({ ...f, nama: e.target.value }))
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-green-500 rounded-full" />
                        Pembina (Guru)
                      </span>
                    </label>
                    <select
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200"
                      value={eskulForm.pembina_guru_id}
                      onChange={(e) =>
                        setEskulForm((f) => ({
                          ...f,
                          pembina_guru_id: e.target.value
                        }))
                      }
                    >
                      <option value="">— Pilih guru —</option>
                      {guruList.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Hari */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-purple-500 rounded-full" />
                        Hari
                      </span>
                    </label>
                    <div className="space-y-2">
                      {/* Dropdown + checkbox multi-hari */}
                      <details className="group relative">
                        <summary className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-purple-500 transition-all duration-200 flex items-center justify-between cursor-pointer list-none">
                          <span className="text-sm text-gray-700">
                            {selectedHariValues.length === 0
                              ? 'Pilih hari'
                              : selectedHariValues.join(', ')}
                          </span>
                          <span className="ml-2 text-xs text-gray-500 group-open:rotate-180 transform transition-transform">
                            ▾
                          </span>
                        </summary>
                        <div className="mt-2 absolute z-20 w-full bg-white border-2 border-purple-100 rounded-xl shadow-lg p-3 max-h-48 overflow-y-auto">
                          {HARI_OPTS.map((h) => {
                            const checked = selectedHariValues.includes(h)
                            return (
                              <label
                                key={h}
                                className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-purple-50 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  className="rounded text-purple-600 focus:ring-purple-500"
                                  checked={checked}
                                  onChange={() => handleToggleHari(h)}
                                />
                                <span className="text-sm text-gray-700">{h}</span>
                              </label>
                            )
                          })}
                        </div>
                      </details>
                      <p className="text-xs text-gray-400">
                        Bisa pilih lebih dari satu hari untuk jadwal ekskul.
                      </p>
                    </div>
                  </div>

                  {/* Jadwal (Mulai) */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-orange-500 rounded-full" />
                        Jadwal (Mulai)
                      </span>
                    </label>
                    <input
                      type="time"
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all duration-200"
                      value={eskulForm.jam_mulai}
                      onChange={(e) =>
                        setEskulForm((f) => ({ ...f, jam_mulai: e.target.value }))
                      }
                    />
                  </div>

                  {/* Jadwal selesai */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-red-500 rounded-full" />
                        Jadwal (Selesai)
                      </span>
                    </label>
                    <input
                      type="time"
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all duration-200"
                      value={eskulForm.jam_selesai}
                      onChange={(e) =>
                        setEskulForm((f) => ({
                          ...f,
                          jam_selesai: e.target.value
                        }))
                      }
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-amber-500 rounded-full" />
                        Batas Pendaftaran Siswa
                      </span>
                    </label>
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
                      <input
                        type="datetime-local"
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all duration-200"
                        value={eskulForm.registration_deadline_at}
                        min={toDateTimeLocalValue(new Date().toISOString())}
                        max={activePeriodEndInput}
                        onChange={(e) => {
                          const raw = e.target.value
                          const date = new Date(raw)
                          setEskulForm((f) => ({
                            ...f,
                            registration_deadline_at: raw && !Number.isNaN(date.getTime())
                              ? toDateTimeLocalValue(clampDateToPeriodEnd(date, activeEskulPeriod).toISOString())
                              : raw
                          }))
                        }}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEskulRegistrationDeadlineByDays(3)}
                          className="px-3 py-2 text-xs font-semibold rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                        >
                          +3 Hari
                        </button>
                        <button
                          type="button"
                          onClick={() => setEskulRegistrationDeadlineByDays(7)}
                          className="px-3 py-2 text-xs font-semibold rounded-lg border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                        >
                          +7 Hari
                        </button>
                        <button
                          type="button"
                          onClick={clearEskulRegistrationDeadline}
                          className="px-3 py-2 text-xs font-semibold rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full font-semibold ${registrationDeadlineIso
                          ? registrationDeadlineClosed
                            ? 'bg-rose-100 text-rose-700 border border-rose-200'
                            : registrationDeadlinePastPeriod
                            ? 'bg-amber-100 text-amber-700 border border-amber-200'
                            : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                          : 'bg-gray-100 text-gray-600 border border-gray-200'
                          }`}
                      >
                        {registrationDeadlineIso
                          ? registrationDeadlineClosed
                            ? 'Pendaftaran Ditutup'
                            : registrationDeadlinePastPeriod
                            ? 'Lewat Periode'
                            : 'Pendaftaran Dibuka'
                          : 'Belum Diatur'}
                      </span>
                      <span className="text-gray-500">
                        Batas: {registrationDeadlineLabel}
                      </span>
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-indigo-500 rounded-full" />
                        Keterangan
                      </span>
                    </label>
                    <textarea
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200 min-h-[100px]"
                      value={eskulForm.keterangan}
                      onChange={(e) =>
                        setEskulForm((f) => ({
                          ...f,
                          keterangan: e.target.value
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Anggota eskul */}
            {eskulSel && (
              <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden transition-all duration-300 hover:shadow-2xl">
                <div className="bg-gradient-to-r from-emerald-600 to-green-700 p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-white/20 rounded-xl">
                        <span className="text-2xl text-white">👥</span>
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold text-white">
                          Anggota • {eskulForm.nama || eskulSel}
                        </h3>
                        <p className="text-emerald-100 mt-1">
                          {anggotaDisplay.length} siswa mengikuti
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="px-4 py-2 bg-white/20 text-white rounded-full text-sm font-medium">
                        🎯 {anggotaDisplay.length} Anggota
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsAddMemberModalOpen(true)}
                        disabled={isViewingArchivePeriod}
                        className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        + Tambah Anggota
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  {isAddMemberModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
                      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-normal text-emerald-600">Anggota Ekstrakurikuler</p>
                            <h3 className="mt-1 text-xl font-semibold text-slate-900">Kelola Anggota</h3>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsAddMemberModalOpen(false)}
                            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                          >
                            Tutup
                          </button>
                        </div>

                        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                          <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${addMemberLocked ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                            {addMemberLocked ? 'Pendaftaran terkunci. Periksa batas pendaftaran atau periode aktif.' : 'Pendaftaran dibuka. Pilih satu siswa, per kelas, atau semua siswa aktif.'}
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            {[
                              ['single', 'Satu siswa'],
                              ['class', 'Per kelas'],
                              ['all', 'Semua siswa']
                            ].map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() => setAddMemberMode(value)}
                                disabled={addMemberLocked}
                                className={`min-h-[42px] rounded-xl border px-3 text-xs font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 ${
                                  addMemberMode === value
                                    ? 'border-emerald-500 bg-emerald-600 text-white shadow-sm'
                                    : 'border-emerald-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>

                          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr]">
                            <div className={addMemberMode === 'all' ? 'hidden' : ''}>
                              <label className="mb-2 block text-xs font-medium uppercase tracking-normal text-slate-500">
                                Kelas
                              </label>
                              <select
                                className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition-all duration-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100"
                                value={addMemberClass}
                                onFocus={() => loadStudentOptions({ force: !studentOptionsLoaded, all: true })}
                                onChange={(e) => setAddMemberClass(e.target.value)}
                                disabled={addMemberLocked || addMemberMode === 'all'}
                              >
                                <option value="">Semua kelas</option>
                                {kelasOptions.map((kelas) => (
                                  <option key={kelas} value={kelas}>{kelas}</option>
                                ))}
                              </select>
                            </div>

                            <div className={addMemberMode === 'single' ? '' : 'hidden'}>
                              <label className="mb-2 block text-xs font-medium uppercase tracking-normal text-slate-500">
                                Cari & Pilih Siswa
                              </label>
                              <div className="flex flex-col gap-2">
                                <input
                                  type="text"
                                  className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition-all duration-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100"
                                  placeholder="Ketik nama atau NIS untuk mencari..."
                                  value={memberSearch}
                                  onChange={(e) => {
                                    setMemberSearch(e.target.value)
                                    setAddMemberUid('')
                                  }}
                                  disabled={addMemberLocked || addMemberMode !== 'single'}
                                />
                                <select
                                  className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition-all duration-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100"
                                  value={addMemberUid}
                                  onChange={(e) => setAddMemberUid(e.target.value)}
                                  disabled={addMemberLocked || addMemberMode !== 'single'}
                                >
                                  <option value="">
                                    {studentOptionsLoading
                                      ? 'Memuat siswa...'
                                      : 'Pilih hasil pencarian'}
                                  </option>
                                  {availableSiswaOptions.map((s) => (
                                    <option key={s.uid} value={s.uid}>
                                      {s.nama} ({s.kelas || 'Tanpa kelas'})
                                    </option>
                                  ))}
                                </select>
                                {memberOptionsHasMore && (
                                  <p className="text-[11px] text-emerald-700 font-semibold">
                                    Hasil dibatasi 50. Ketik lebih spesifik jika siswa tidak ditemukan.
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <h4 className="flex items-center gap-3 text-lg font-semibold text-gray-900">
                                <span className="rounded-lg bg-emerald-100 p-2 text-emerald-600">
                                  📊
                                </span>
                                Daftar Anggota
                              </h4>
                              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                                {anggotaDisplay.length} siswa
                              </span>
                            </div>
                            <div className="space-y-4 relative min-h-[400px]">
                              {anggotaDisplay.length === 0 ? (
                                <div className="py-12 text-center">
                                  <div className="mb-4 text-6xl text-gray-300">👥</div>
                                  <p className="text-lg font-medium text-gray-500">
                                    Belum ada anggota
                                  </p>
                                  <p className="mt-2 text-gray-400">
                                    Tambahkan siswa ke ekskul ini
                                  </p>
                                </div>
                              ) : (
                                <div className="absolute inset-0">
                                  <List
                                    rowComponent={EskulMemberRow}
                                    rowCount={anggotaDisplay.length}
                                    rowHeight={104}
                                    rowProps={{
                                      items: anggotaDisplay,
                                      isArchive: isViewingArchivePeriod,
                                      onRemove: hapusAnggotaEskul
                                    }}
                                    style={{ height: 400, width: '100%' }}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50 px-6 py-5 sm:flex-row sm:justify-end">
                          <button
                            type="button"
                            onClick={() => setIsAddMemberModalOpen(false)}
                            className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                          >
                            Batal
                          </button>
                          <button
                            type="button"
                            className="min-h-[44px] rounded-xl bg-emerald-600 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={tambahAnggotaEskul}
                            disabled={
                              addMemberLocked ||
                              studentOptionsLoading ||
                              (addMemberMode === 'single' && !addMemberUid) ||
                              (addMemberMode === 'class' && !addMemberClass)
                            }
                          >
                            {studentOptionsLoading ? 'Memuat...' : addMemberMode === 'single' ? 'Tambah Siswa' : addMemberMode === 'class' ? 'Tambah Kelas' : 'Tambah Semua'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
