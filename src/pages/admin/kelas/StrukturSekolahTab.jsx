import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Briefcase,
  Building2,
  CheckCircle2,
  Copy,
  GraduationCap,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  UserCheck,
  Users,
  X
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { queryClient, queryKeys } from '../../../lib/queryClient'
import { useLocalCache } from '../../../hooks/useLocalCache'

const DEFAULT_POS = [
  'Kepala Sekolah',
  'Wakil Kepala Sekolah',
  'Kurikulum',
  'Kesiswaan',
  'Sarpras',
  'Humas',
  'Bendahara',
  'Tata Usaha'
]

const GRADE_OPTS = ['VII', 'VIII', 'IX', 'X', 'XI', 'XII']
const GRADE_ORDER = Object.fromEntries(GRADE_OPTS.map((g, i) => [g, i]))
const GRADE_REGEX = /^\s*(XII|XI|X|IX|VIII|VII)\b/i
const FORBIDDEN = /[.#$[\]]/

const normalizeSpaces = (value = '') => String(value || '').replace(/\s+/g, ' ').trim()

const parseGrade = (name = '') => {
  const match = normalizeSpaces(name).toUpperCase().match(GRADE_REGEX)
  return match ? match[1] : ''
}

const stripGradePrefix = (name = '') => {
  const grade = parseGrade(name)
  const value = normalizeSpaces(name)
  if (!grade) return value
  return normalizeSpaces(value.replace(new RegExp(`^${grade}\\b\\s*`, 'i'), ''))
}

const slug = (value = '') => {
  const normalized = normalizeSpaces(value)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)

  return normalized || 'posisi'
}

const makePositionId = (jabatan = '') => {
  const base = slug(jabatan)
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const maxBaseLength = Math.max(1, 80 - suffix.length - 1)
  const trimmedBase = base.slice(0, maxBaseLength).replace(/-+$/g, '') || 'posisi'
  return `${trimmedBase}-${suffix}`
}

const includesQuery = (query, ...values) => {
  const q = normalizeSpaces(query).toLowerCase()
  if (!q) return true
  return values.some((value) => String(value || '').toLowerCase().includes(q))
}

const confirmDelete = (message = 'Yakin mau dihapus?') => window.confirm(message)

const cacheKeyPart = (value = 'active') => (
  normalizeSpaces(value || 'active').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'active'
)

function StatCard({ icon: Icon, label, value, description, tone = 'slate' }) {
  const toneClass = {
    slate: 'border-slate-200 bg-white text-slate-700',
    blue: 'border-blue-200 bg-blue-50/60 text-blue-700',
    emerald: 'border-emerald-200 bg-emerald-50/60 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50/60 text-amber-700'
  }[tone] || 'border-slate-200 bg-white text-slate-700'

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
          {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

function SectionCard({ title, description, icon: Icon, meta, action, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {meta && (
            <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">
              {meta}
            </span>
          )}
          {action}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function FieldLabel({ children, required = false }) {
  return (
    <label className="mb-2 block text-sm font-semibold text-slate-700">
      {children}
      {required && <span className="text-red-500"> *</span>}
    </label>
  )
}

function TeacherSelect({ value, onChange, options, placeholder = 'Pilih guru', disabled = false }) {
  return (
    <select
      className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
      value={value || ''}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      <option value="">{placeholder}</option>
      {options.map((guru) => (
        <option key={guru.id} value={guru.id}>
          {guru.label}
        </option>
      ))}
    </select>
  )
}

function StatusBadge({ active, activeLabel = 'Terisi', inactiveLabel = 'Belum diisi' }) {
  return active ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
      <CheckCircle2 className="h-3.5 w-3.5" />
      {activeLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
      <AlertCircle className="h-3.5 w-3.5" />
      {inactiveLabel}
    </span>
  )
}

function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm">
        <Icon className="h-7 w-7" />
      </div>
      <p className="mt-4 text-sm font-bold text-slate-700">{title}</p>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
    </div>
  )
}

export default function StrukturSekolahTab({
  guruList,
  academicPeriod = null,
  activeAcademicPeriod = null,
  academicYearOptions = [],
  pushToast,
  showHeader = true,
  readOnly = false
}) {
  const periodKey = useMemo(() => cacheKeyPart(academicPeriod?.tahunAjaran || 'active'), [academicPeriod?.tahunAjaran])
  const [cachedSummary, setCachedSummary, hasSummaryCache] = useLocalCache(`admin_struktur_sekolah_summary_${periodKey}`, {
    struktur: [],
    waliKelas: [],
    guruList: []
  })
  const [struktur, setStruktur] = useState(() => Array.isArray(cachedSummary?.struktur) ? cachedSummary.struktur : [])
  const [waliKelas, setWaliKelas] = useState(() => Array.isArray(cachedSummary?.waliKelas) ? cachedSummary.waliKelas : [])
  const [summaryGuruList, setSummaryGuruList] = useState(() => Array.isArray(cachedSummary?.guruList) ? cachedSummary.guruList : [])
  const [posBaru, setPosBaru] = useState('')
  const [posGuru, setPosGuru] = useState('')
  const [loading, setLoading] = useState(() => !hasSummaryCache)
  const [refreshing, setRefreshing] = useState(false)
  const [savingKey, setSavingKey] = useState('')
  const [positionSearch, setPositionSearch] = useState('')
  const [waliSearch, setWaliSearch] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [editingPosition, setEditingPosition] = useState({ id: '', guruId: '' })
  const [editingWali, setEditingWali] = useState({ id: '', guruId: '' })
  const copySourceOptions = useMemo(() => {
    const currentYear = academicPeriod?.tahunAjaran || activeAcademicPeriod?.tahunAjaran || ''
    return (academicYearOptions || [])
      .map((option) => (typeof option === 'string' ? { value: option, label: option } : option))
      .filter((option) => option?.value && option.value !== currentYear)
  }, [academicPeriod?.tahunAjaran, academicYearOptions, activeAcademicPeriod?.tahunAjaran])
  const [copySourceYear, setCopySourceYear] = useState(() => copySourceOptions[0]?.value || '')
  const [copyingStructure, setCopyingStructure] = useState(false)

  useEffect(() => {
    setCopySourceYear((current) => {
      if (copySourceOptions.some((option) => option.value === current)) return current
      return copySourceOptions[0]?.value || ''
    })
  }, [copySourceOptions])

  const guruOptions = useMemo(() => {
    const source = Array.isArray(guruList) && guruList.length ? guruList : summaryGuruList
    return (source || [])
      .filter((guru) => guru?.id)
      .map((guru) => {
        const name = guru.name || guru.nama || guru.email || guru.id
        return {
          id: guru.id,
          name,
          email: guru.email || '',
          status: guru.status || '',
          label: guru.label || `${name}${guru.email ? ` (${guru.email})` : ''}`
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'id'))
  }, [guruList, summaryGuruList])

  const teacherById = useMemo(() => {
    return new Map(guruOptions.map((guru) => [guru.id, guru]))
  }, [guruOptions])

  const getTeacherName = useCallback((guruId = '') => {
    if (!guruId) return ''
    return teacherById.get(guruId)?.name || ''
  }, [teacherById])

  useEffect(() => {
    const cachedStruktur = Array.isArray(cachedSummary?.struktur) ? cachedSummary.struktur : []
    const cachedWaliKelas = Array.isArray(cachedSummary?.waliKelas) ? cachedSummary.waliKelas : []
    const cachedGuruList = Array.isArray(cachedSummary?.guruList) ? cachedSummary.guruList : []

    setStruktur(cachedStruktur)
    setWaliKelas(cachedWaliKelas)
    setSummaryGuruList(cachedGuruList)
    setLoading(!hasSummaryCache && !cachedStruktur.length && !cachedWaliKelas.length && !cachedGuruList.length)
  }, [cachedSummary, hasSummaryCache])

  const loadData = useCallback(async ({ silent = false, force = false } = {}) => {
    try {
      const shouldBlock = !silent && !hasSummaryCache

      if (shouldBlock) {
        setLoading(true)
      } else {
        setRefreshing(true)
      }

      const params = {
        include_students: false,
        include_schedule: false,
        include_mapel: false
      }
      if (academicPeriod?.tahunAjaran) {
        params.tahun_ajaran = academicPeriod.tahunAjaran
      }

      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.admin.structureBootstrap(params),
        queryFn: async () => {
          const { data: summaryData, error } = await supabase.admin.strukturBootstrap(params)
          if (error) throw error
          return summaryData || {}
        },
        staleTime: force ? 0 : 60 * 1000
      })

      const strukturRows = (data?.struktur_sekolah || []).map((row) => ({
        ...row,
        jabatan: normalizeSpaces(row.jabatan) || row.id
      }))

      const strukturByKelasId = new Map(
        ((data?.kelas_struktur || data?.struktur || [])).map((row) => [row.kelas_id, row])
      )

      const waliRows = (data?.kelas || []).map((kelas) => {
        const kelasStruktur = strukturByKelasId.get(kelas.id) || {}
        return {
          id: kelas.id,
          nama_kelas: kelas.nama || kelas.id,
          grade: kelas.grade || parseGrade(kelas.nama || kelas.id),
          suffix: kelas.suffix || stripGradePrefix(kelas.nama || kelas.id),
          wali_guru_id: kelasStruktur.wali_guru_id || '',
          wali_guru_nama: kelasStruktur.wali_guru_nama || '',
          updated_at: kelasStruktur.updated_at || ''
        }
      })

      waliRows.sort((a, b) => {
        const ag = GRADE_ORDER[a.grade] ?? 999
        const bg = GRADE_ORDER[b.grade] ?? 999
        if (ag !== bg) return ag - bg
        return (a.suffix || '').localeCompare(b.suffix || '', 'id')
      })

      setStruktur(strukturRows)
      setWaliKelas(waliRows)
      const guruRows = (data?.guru || []).map((guru) => {
        const name = guru.nama || guru.email || guru.id
        return {
          ...guru,
          name,
          label: `${name}${guru.email ? ` (${guru.email})` : ''}`
        }
      })

      setSummaryGuruList(guruRows)
      setCachedSummary({
        struktur: strukturRows,
        waliKelas: waliRows,
        guruList: guruRows
      })
    } catch (error) {
      console.error('Error loading struktur sekolah:', error)
      pushToast('error', error?.message || 'Gagal memuat struktur sekolah')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [academicPeriod?.tahunAjaran, hasSummaryCache, pushToast, setCachedSummary])

  const loadedPeriodRef = useRef('')
  useEffect(() => {
    if (loadedPeriodRef.current === periodKey) return
    loadedPeriodRef.current = periodKey
    loadData({ silent: hasSummaryCache })
  }, [hasSummaryCache, loadData, periodKey])

  const formatNamaKelas = useCallback((kelas) => {
    if (kelas.nama_kelas) return kelas.nama_kelas
    return `${kelas.grade || parseGrade(kelas.id)} ${kelas.suffix || ''}`.trim()
  }, [])

  const stats = useMemo(() => {
    const assignedPositions = struktur.filter((item) => item.guru_id).length
    const assignedClasses = waliKelas.filter((item) => item.wali_guru_id).length

    return {
      positions: struktur.length,
      assignedPositions,
      classes: waliKelas.length,
      assignedClasses,
      teachers: guruOptions.length,
      missingTotal: (struktur.length - assignedPositions) + (waliKelas.length - assignedClasses)
    }
  }, [guruOptions.length, struktur, waliKelas])

  const filteredStruktur = useMemo(() => {
    return struktur.filter((item) => includesQuery(
      positionSearch,
      item.jabatan,
      item.guru_nama,
      getTeacherName(item.guru_id)
    ))
  }, [getTeacherName, positionSearch, struktur])

  const filteredWaliKelas = useMemo(() => {
    return waliKelas.filter((item) => {
      if (gradeFilter && item.grade !== gradeFilter) return false
      return includesQuery(
        waliSearch,
        formatNamaKelas(item),
        item.grade,
        item.suffix,
        item.wali_guru_nama,
        getTeacherName(item.wali_guru_id)
      )
    })
  }, [formatNamaKelas, getTeacherName, gradeFilter, waliKelas, waliSearch])

  async function addPosisi(event) {
    event?.preventDefault()
    if (readOnly) {
      pushToast('info', 'Riwayat periode hanya bisa dilihat.')
      return
    }

    const jabatan = normalizeSpaces(posBaru)
    const normalizedJabatan = jabatan.toLowerCase()

    if (!jabatan) {
      pushToast('error', 'Nama jabatan harus diisi')
      return
    }

    if (FORBIDDEN.test(jabatan)) {
      pushToast('error', 'Nama jabatan tidak boleh mengandung . # $ [ ]')
      return
    }

    const duplicate = struktur.some((item) => normalizeSpaces(item.jabatan).toLowerCase() === normalizedJabatan)
    if (duplicate) {
      pushToast('error', 'Jabatan tersebut sudah ada di struktur sekolah ini')
      return
    }

    const guruNama = posGuru ? getTeacherName(posGuru) : ''
    const payload = {
      id: makePositionId(jabatan),
      jabatan,
      guru_id: posGuru || null,
      guru_nama: guruNama,
      tahun_ajaran: academicPeriod?.tahunAjaran || null,
      semester: academicPeriod?.semester || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    try {
      setSavingKey('add-position')
      const { error } = await supabase
        .from('struktur_sekolah')
        .insert(payload)

      if (error) throw error

      pushToast('success', `Jabatan "${jabatan}" berhasil ditambahkan`)
      setPosBaru('')
      setPosGuru('')
      await loadData({ silent: true, force: true })
    } catch (error) {
      console.error('Error adding posisi:', error)
      pushToast('error', error?.message || 'Gagal menambah jabatan')
    } finally {
      setSavingKey('')
    }
  }

  function startEditPosition(item) {
    setEditingWali({ id: '', guruId: '' })
    setEditingPosition({ id: item.id, guruId: item.guru_id || '' })
  }

  async function savePosition(item) {
    if (readOnly) {
      pushToast('info', 'Riwayat periode hanya bisa dilihat.')
      return
    }

    const guruId = editingPosition.guruId || ''
    const guruNama = guruId ? getTeacherName(guruId) : ''

    try {
      setSavingKey(`position-${item.id}`)
      const { error } = await supabase
        .from('struktur_sekolah')
        .update({
          guru_id: guruId || null,
          guru_nama: guruNama,
          tahun_ajaran: academicPeriod?.tahunAjaran || null,
          semester: academicPeriod?.semester || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', item.id)

      if (error) throw error

      pushToast('success', 'Penanggung jawab jabatan berhasil disimpan')
      setEditingPosition({ id: '', guruId: '' })
      await loadData({ silent: true, force: true })
    } catch (error) {
      console.error('Error updating posisi:', error)
      pushToast('error', error?.message || 'Gagal menyimpan jabatan')
    } finally {
      setSavingKey('')
    }
  }

  async function deletePosition(item) {
    if (readOnly) {
      pushToast('info', 'Riwayat periode hanya bisa dilihat.')
      return
    }

    if (!confirmDelete(`Hapus jabatan "${item.jabatan}" dari struktur sekolah?`)) return

    try {
      setSavingKey(`delete-position-${item.id}`)
      const { error } = await supabase
        .from('struktur_sekolah')
        .delete()
        .eq('id', item.id)

      if (error) throw error

      pushToast('success', 'Jabatan berhasil dihapus')
      await loadData({ silent: true, force: true })
    } catch (error) {
      console.error('Error deleting posisi:', error)
      pushToast('error', error?.message || 'Gagal menghapus jabatan')
    } finally {
      setSavingKey('')
    }
  }

  function startEditWali(item) {
    setEditingPosition({ id: '', guruId: '' })
    setEditingWali({ id: item.id, guruId: item.wali_guru_id || '' })
  }

  async function saveWaliKelas(item) {
    if (readOnly) {
      pushToast('info', 'Riwayat periode hanya bisa dilihat.')
      return
    }

    const guruId = editingWali.guruId || ''
    const guruNama = guruId ? getTeacherName(guruId) : ''

    try {
      setSavingKey(`wali-${item.id}`)
      const { error } = await supabase
        .from('kelas_struktur')
        .upsert({
          kelas_id: item.id,
          wali_guru_id: guruId || null,
          wali_guru_nama: guruNama,
          tahun_ajaran: academicPeriod?.tahunAjaran || null,
          semester: academicPeriod?.semester || null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'tenant_id,kelas_id,tahun_ajaran' })

      if (error) throw error

      pushToast('success', 'Wali kelas berhasil disimpan')
      setEditingWali({ id: '', guruId: '' })
      await loadData({ silent: true, force: true })
    } catch (error) {
      console.error('Error updating wali kelas:', error)
      pushToast('error', error?.message || 'Gagal menyimpan wali kelas')
    } finally {
      setSavingKey('')
    }
  }

  async function copyStructureFromPeriod() {
    const targetYear = academicPeriod?.tahunAjaran || ''
    if (readOnly || !targetYear || !copySourceYear) return

    const confirmed = window.confirm(
      `Salin struktur sekolah dan organisasi dari periode ${copySourceYear} ke periode ${targetYear}? Data yang sudah ada akan diperbarui jika namanya sama.`
    )
    if (!confirmed) return

    try {
      setCopyingStructure(true)
      const { data, error } = await supabase.admin.copyAcademicStructure({
        source_tahun_ajaran: copySourceYear,
        target_tahun_ajaran: targetYear,
        include_organizations: true,
        replace: false
      })
      if (error) throw error

      const summary = data?.summary || {}
      pushToast(
        'success',
        `Struktur disalin: ${summary.struktur_sekolah || 0} jabatan, ${summary.kelas_struktur || 0} wali kelas, ${summary.organisasi || 0} organisasi.`
      )
      await loadData({ silent: true, force: true })
    } catch (error) {
      console.error('Error copying struktur sekolah:', error)
      pushToast('error', error?.message || 'Gagal menyalin struktur periode')
    } finally {
      setCopyingStructure(false)
    }
  }

  const busy = loading || Boolean(savingKey)
  const initialLoading = loading && !struktur.length && !waliKelas.length && !guruOptions.length

  return (
    <div className="space-y-6">
      {showHeader && (
        <section className="page-title-card">
          <div className="page-title-layout">
            <div className="page-title-main">
              <div className="page-title-icon bg-blue-100 text-blue-700">
                <Building2 className="h-6 w-6" />
              </div>
              <div>
                <h2 className="page-title-heading">Struktur Sekolah</h2>
                <p className="page-title-description">
                  Kelola jabatan formal, penanggung jawab, dan wali kelas aktif.
                </p>
              </div>
            </div>
            <div className="page-title-actions">
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => loadData({ silent: true, force: true })}
                disabled={busy || refreshing}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Muat ulang
              </button>
            </div>
          </div>
        </section>
      )}

      {(initialLoading || refreshing) && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm font-semibold text-blue-700">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {initialLoading ? 'Memuat data struktur sekolah...' : 'Memperbarui data struktur sekolah...'}
          </div>
        </div>
      )}

      {readOnly && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Riwayat periode {academicPeriod?.tahunAjaran || 'ini'} hanya bisa dilihat.
        </div>
      )}

      {!readOnly && copySourceOptions.length > 0 && (
        <SectionCard
          icon={Copy}
          title="Salin Dari Periode"
          description="Gunakan struktur periode sebelumnya sebagai dasar periode aktif."
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="md:w-72">
              <FieldLabel>Periode sumber</FieldLabel>
              <select
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={copySourceYear}
                onChange={(event) => setCopySourceYear(event.target.value)}
                disabled={copyingStructure}
              >
                {copySourceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label || option.value}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={copyStructureFromPeriod}
              disabled={copyingStructure || !copySourceYear}
            >
              {copyingStructure ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              Salin Struktur
            </button>
          </div>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Briefcase}
          label="Jabatan"
          value={stats.positions}
          description={`${stats.assignedPositions} sudah ada penanggung jawab`}
          tone="blue"
        />
        <StatCard
          icon={GraduationCap}
          label="Wali kelas"
          value={`${stats.assignedClasses}/${stats.classes}`}
          description="Kelas yang sudah memiliki wali"
          tone="emerald"
        />
        <StatCard
          icon={Users}
          label="Guru tersedia"
          value={stats.teachers}
          description="Guru yang bisa dipilih"
          tone="slate"
        />
        <StatCard
          icon={AlertCircle}
          label="Perlu dilengkapi"
          value={stats.missingTotal}
          description="Jabatan atau kelas tanpa penanggung jawab"
          tone={stats.missingTotal ? 'amber' : 'emerald'}
        />
      </div>

      <SectionCard
        icon={Plus}
        title="Tambah Jabatan"
        description="Buat jabatan baru lalu pilih penanggung jawabnya bila sudah tersedia."
      >
        <form onSubmit={addPosisi} className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-end">
          <div>
            <FieldLabel required>Nama jabatan</FieldLabel>
            <input
              className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              list="list-posisi"
              placeholder="Contoh: Kepala Sekolah"
              value={posBaru}
              onChange={(event) => setPosBaru(event.target.value)}
              disabled={readOnly || Boolean(savingKey)}
            />
            <datalist id="list-posisi">
              {DEFAULT_POS.map((position) => (
                <option key={position} value={position} />
              ))}
            </datalist>
          </div>
          <div>
            <FieldLabel>Penanggung jawab</FieldLabel>
            <TeacherSelect
              value={posGuru}
              onChange={setPosGuru}
              options={guruOptions}
              disabled={readOnly || Boolean(savingKey)}
            />
          </div>
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={readOnly || busy || !normalizeSpaces(posBaru)}
          >
            {savingKey === 'add-position' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Tambah
          </button>
        </form>
      </SectionCard>

      <SectionCard
        icon={Briefcase}
        title="Jabatan Sekolah"
        description="Ubah penanggung jawab setiap jabatan dengan tombol edit lalu simpan."
        meta={`${filteredStruktur.length} dari ${struktur.length} jabatan`}
        action={
          !showHeader && (
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => loadData({ silent: true, force: true })}
              disabled={busy || refreshing}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Muat ulang
            </button>
          )
        }
      >
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              placeholder="Cari jabatan atau guru"
              value={positionSearch}
              onChange={(event) => setPositionSearch(event.target.value)}
            />
          </div>
        </div>

        {initialLoading ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
            <div className="flex items-center justify-center gap-2 text-sm font-semibold text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              Memuat jabatan sekolah...
            </div>
          </div>
        ) : filteredStruktur.length ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-bold text-slate-600">Jabatan</th>
                    <th className="px-4 py-3 text-left font-bold text-slate-600">Penanggung jawab</th>
                    <th className="px-4 py-3 text-left font-bold text-slate-600">Status</th>
                    <th className="px-4 py-3 text-right font-bold text-slate-600">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredStruktur.map((item) => {
                    const editing = editingPosition.id === item.id
                    const teacherName = item.guru_nama || getTeacherName(item.guru_id)
                    const rowSaving = savingKey === `position-${item.id}` || savingKey === `delete-position-${item.id}`

                    return (
                      <tr key={item.id} className="transition hover:bg-slate-50/70">
                        <td className="px-4 py-4 align-middle">
                          <div className="font-bold text-slate-900">{item.jabatan}</div>
                        </td>
                        <td className="min-w-[260px] px-4 py-4 align-middle">
                          {editing ? (
                            <TeacherSelect
                              value={editingPosition.guruId}
                              onChange={(guruId) => setEditingPosition({ id: item.id, guruId })}
                              options={guruOptions}
                              placeholder="Kosongkan penanggung jawab"
                              disabled={readOnly || Boolean(savingKey)}
                            />
                          ) : teacherName ? (
                            <div className="flex items-center gap-2 text-slate-700">
                              <UserCheck className="h-4 w-4 text-emerald-600" />
                              <span className="font-medium">{teacherName}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">Belum ada penanggung jawab</span>
                          )}
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <StatusBadge active={Boolean(item.guru_id)} />
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <div className="flex justify-end gap-2">
                            {editing ? (
                              <>
                                <button
                                  type="button"
                                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-60"
                                  onClick={() => savePosition(item)}
                                  disabled={readOnly || Boolean(savingKey)}
                                >
                                  {rowSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                  Simpan
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                                  onClick={() => setEditingPosition({ id: '', guruId: '' })}
                                  disabled={Boolean(savingKey)}
                                >
                                  <X className="h-4 w-4" />
                                  Batal
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                                  onClick={() => startEditPosition(item)}
                                  disabled={readOnly || busy}
                                  title="Edit penanggung jawab"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-9 items-center justify-center rounded-xl border border-red-200 bg-white px-3 text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                                  onClick={() => deletePosition(item)}
                                  disabled={readOnly || busy}
                                  title="Hapus jabatan"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={Briefcase}
            title={struktur.length ? 'Tidak ada jabatan yang cocok' : 'Belum ada jabatan'}
            description={struktur.length ? 'Ubah kata kunci pencarian untuk melihat data lain.' : 'Tambahkan jabatan sekolah dari form di atas.'}
          />
        )}
      </SectionCard>

      <SectionCard
        icon={GraduationCap}
        title="Wali Kelas"
        description="Kelola wali kelas berdasarkan daftar kelas aktif."
        meta={`${stats.assignedClasses} dari ${stats.classes} kelas terisi`}
      >
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              placeholder="Cari kelas atau wali kelas"
              value={waliSearch}
              onChange={(event) => setWaliSearch(event.target.value)}
            />
          </div>
          <select
            className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            value={gradeFilter}
            onChange={(event) => setGradeFilter(event.target.value)}
          >
            <option value="">Semua tingkatan</option>
            {GRADE_OPTS.map((grade) => (
              <option key={grade} value={grade}>
                Kelas {grade}
              </option>
            ))}
          </select>
        </div>

        {initialLoading ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
            <div className="flex items-center justify-center gap-2 text-sm font-semibold text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              Memuat wali kelas...
            </div>
          </div>
        ) : filteredWaliKelas.length ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-bold text-slate-600">Kelas</th>
                    <th className="px-4 py-3 text-left font-bold text-slate-600">Wali kelas</th>
                    <th className="px-4 py-3 text-left font-bold text-slate-600">Status</th>
                    <th className="px-4 py-3 text-right font-bold text-slate-600">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredWaliKelas.map((item) => {
                    const editing = editingWali.id === item.id
                    const teacherName = item.wali_guru_nama || getTeacherName(item.wali_guru_id)
                    const rowSaving = savingKey === `wali-${item.id}`

                    return (
                      <tr key={item.id} className="transition hover:bg-slate-50/70">
                        <td className="px-4 py-4 align-middle">
                          <div className="font-bold text-slate-900">{formatNamaKelas(item)}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            Tingkat {item.grade || '-'}{item.suffix ? `, rombel ${item.suffix}` : ''}
                          </div>
                        </td>
                        <td className="min-w-[260px] px-4 py-4 align-middle">
                          {editing ? (
                            <TeacherSelect
                              value={editingWali.guruId}
                              onChange={(guruId) => setEditingWali({ id: item.id, guruId })}
                              options={guruOptions}
                              placeholder="Kosongkan wali kelas"
                              disabled={readOnly || Boolean(savingKey)}
                            />
                          ) : teacherName ? (
                            <div className="flex items-center gap-2 text-slate-700">
                              <UserCheck className="h-4 w-4 text-emerald-600" />
                              <span className="font-medium">{teacherName}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">Belum ada wali kelas</span>
                          )}
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <StatusBadge active={Boolean(item.wali_guru_id)} activeLabel="Ada wali" inactiveLabel="Kosong" />
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <div className="flex justify-end gap-2">
                            {editing ? (
                              <>
                                <button
                                  type="button"
                                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-60"
                                  onClick={() => saveWaliKelas(item)}
                                  disabled={readOnly || Boolean(savingKey)}
                                >
                                  {rowSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                  Simpan
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                                  onClick={() => setEditingWali({ id: '', guruId: '' })}
                                  disabled={Boolean(savingKey)}
                                >
                                  <X className="h-4 w-4" />
                                  Batal
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                                onClick={() => startEditWali(item)}
                                disabled={readOnly || busy}
                              >
                                <Pencil className="h-4 w-4" />
                                Edit
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={GraduationCap}
            title={waliKelas.length ? 'Tidak ada kelas yang cocok' : 'Belum ada data kelas'}
            description={waliKelas.length ? 'Ubah filter tingkatan atau kata kunci pencarian.' : 'Tambahkan kelas terlebih dahulu di menu Kelas.'}
          />
        )}
      </SectionCard>
    </div>
  )
}
