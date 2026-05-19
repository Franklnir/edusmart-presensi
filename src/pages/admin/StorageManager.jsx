import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  BarChart3,
  CheckCircle2,
  Cloud,
  Database,
  FileText,
  HardDrive,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  XCircle
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'

const CATEGORIES = [
  { value: '', label: 'Semua kategori' },
  { value: 'tugas', label: 'Tugas' },
  { value: 'kuis', label: 'Kuis' },
  { value: 'materi', label: 'Materi' },
  { value: 'video', label: 'Video' },
  { value: 'dokumen', label: 'Dokumen' },
  { value: 'lampiran', label: 'Lampiran' },
  { value: 'arsip', label: 'Arsip' }
]

const CLEANUP_CATEGORIES = [
  { value: '', label: 'Tugas, quiz, lampiran' },
  { value: 'tugas', label: 'Tugas' },
  { value: 'kuis', label: 'Quiz' },
  { value: 'lampiran', label: 'Lampiran tugas' }
]

const CLEANUP_PROVIDER_OPTIONS = [
  { value: 'local', label: 'VPS Storage' },
  { value: 'object_storage', label: 'Neva Cloud S3' }
]

const CLEANUP_BUCKET_OPTIONS = [
  { value: '', label: 'Pilih bucket storage' },
  { value: 'assignments', label: 'Tugas / Assignments' },
  { value: 'quiz-media', label: 'Media Quiz' }
]

const CLEANUP_AGE_OPTIONS = [
  { value: '90', label: 'Minimal 3 bulan' },
  { value: '180', label: 'Lebih dari 180 hari' },
  { value: '365', label: 'Lebih dari 1 tahun' }
]

const CLEANUP_PERCENT_OPTIONS = [
  { value: '', label: 'Semua ukuran' },
  { value: '10', label: '10% file terbesar' },
  { value: '20', label: '20% file terbesar' },
  { value: '30', label: '30% file terbesar' },
  { value: '50', label: '50% file terbesar' }
]

const NEVA_BUCKET_LABELS = {
  assignments: 'Tugas',
  'quiz-media': 'Media Quiz',
  certificates: 'Sertifikat',
  'sertifikat-files': 'File Sertifikat',
  'certificate-templates': 'Template Sertifikat',
  'sertifikat-templates': 'Template Sertifikat'
}

const numberFormatter = new Intl.NumberFormat('id-ID')
const toBytesFromGb = (value) => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.round(num * 1024 * 1024 * 1024) : null
}
const bytesToGbInput = (bytes) => bytes ? String(Math.round((Number(bytes) / 1024 / 1024 / 1024) * 100) / 100) : ''
const activeTabFromUrl = () => {
  if (typeof window === 'undefined') return 'storage'
  return new URLSearchParams(window.location.search).get('tab') === 'neva' ? 'neva' : 'storage'
}
const selectedTenantFromUrl = () => {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('tenant') || ''
}
const periodValue = (tahunAjaran, semester) => (
  tahunAjaran && semester ? `${tahunAjaran}|${semester}` : ''
)
const parsePeriodValue = (value) => {
  const [tahunAjaran = '', semester = ''] = String(value || '').split('|')
  return { tahun_ajaran: tahunAjaran, semester }
}
const periodRank = (tahunAjaran, semester) => {
  const match = String(tahunAjaran || '').match(/^(\d{4})\/\d{4}$/)
  if (!match) return null
  if (semester !== 'Ganjil' && semester !== 'Genap') return null
  return (Number(match[1]) * 2) + (semester === 'Genap' ? 1 : 0)
}
const providerPercentLabel = (quota) => (
  quota?.percent !== null && quota?.percent !== undefined ? `${quota.percent}%` : 'Belum dibatasi'
)

const providerBadgeClass = (enabled) => (
  enabled
    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : 'bg-amber-100 text-amber-800 border-amber-200'
)

function StatTile({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{value || '-'}</p>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-slate-100 text-slate-700">
          <Icon size={18} />
        </span>
      </div>
      {hint ? <p className="mt-2 text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}

function ProgressLine({ label, value, percent }) {
  const safePercent = Math.max(0, Math.min(100, Number(percent || 0)))
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div
          className="h-2 rounded-full bg-indigo-600"
          style={{ width: `${safePercent}%` }}
        />
      </div>
    </div>
  )
}

function StorageManager() {
  const { isSuperAdmin, superAdminChecked } = useAuthStore()
  const { pushToast } = useUIStore()
  const [loading, setLoading] = useState(false)
  const [storageError, setStorageError] = useState('')
  const [activeTab, setActiveTab] = useState(activeTabFromUrl)
  const [summary, setSummary] = useState(null)
  const [superSummary, setSuperSummary] = useState(null)
  const [selectedTenantId, setSelectedTenantId] = useState(selectedTenantFromUrl)
  const [tenantDetail, setTenantDetail] = useState(null)
  const [quotaForm, setQuotaForm] = useState({
    vpsQuotaGb: '',
    nevaQuotaGb: '',
    notes: ''
  })
  const [storageFilters, setStorageFilters] = useState({ tahun_ajaran: '', semester: '', category: '' })
  const [storageFilterDraft, setStorageFilterDraft] = useState({ tahun_ajaran: '', semester: '', category: '' })
  const [cleanupForm, setCleanupForm] = useState({
    provider: 'local',
    bucket: '',
    tahun_ajaran: '',
    semester: '',
    category: '',
    older_than_days: '90',
    largest_percent: ''
  })
  const [cleanupPreview, setCleanupPreview] = useState(null)
  const [savingQuota, setSavingQuota] = useState(false)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [syncingObjectStorage, setSyncingObjectStorage] = useState(false)
  const [restoringTrashId, setRestoringTrashId] = useState('')
  const [purgingTrash, setPurgingTrash] = useState(false)

  const activeSummary = tenantDetail || summary || {}
  const providerSummaries = activeSummary?.provider_summaries || {}
  const vpsSummary = providerSummaries?.vps || {}
  const nevaSummary = providerSummaries?.neva_s3 || activeSummary?.object_storage || {}
  const activeProviderSummary = activeTab === 'neva' ? nevaSummary : vpsSummary
  const usage = activeProviderSummary?.usage || activeSummary?.usage || {}
  const quota = activeProviderSummary?.quota || activeSummary?.quota || {}
  const allQuota = activeSummary?.quota || {}
  const vpsQuota = activeSummary?.providers?.vps || allQuota?.providers?.vps || vpsSummary?.quota || {}
  const nevaQuota = activeSummary?.providers?.neva_s3 || allQuota?.providers?.neva_s3 || nevaSummary?.quota || {}
  const categories = Array.isArray(usage?.by_category) ? usage.by_category : []
  const periods = Array.isArray(usage?.by_period) ? usage.by_period : []
  const periodCatalog = Array.isArray(activeSummary?.period_options) ? activeSummary.period_options : []
  const largestFiles = Array.isArray(activeProviderSummary?.largest_files)
    ? activeProviderSummary.largest_files
    : Array.isArray(activeSummary?.largest_files)
      ? activeSummary.largest_files
      : []
  const uploaders = Array.isArray(activeProviderSummary?.by_uploader)
    ? activeProviderSummary.by_uploader
    : Array.isArray(activeSummary?.by_uploader)
      ? activeSummary.by_uploader
      : []
  const recommendations = Array.isArray(activeSummary?.recommendations) ? activeSummary.recommendations : []
  const trashFiles = Array.isArray(activeSummary?.trash_files) ? activeSummary.trash_files : []
  const nevaPlatform = superSummary?.object_storage || activeSummary?.object_storage_status || {}
  const nevaEnabled = nevaPlatform?.enabled !== undefined ? nevaPlatform.enabled !== false : true
  const nevaDirectEnabled = Boolean(nevaPlatform?.browser_direct_enabled)
  const nevaBucketMap = nevaPlatform?.bucket_map && typeof nevaPlatform.bucket_map === 'object'
    ? nevaPlatform.bucket_map
    : {}
  const activeBucketRows = Array.isArray(activeProviderSummary?.bucket_usage) ? activeProviderSummary.bucket_usage : []
  const nevaBucketUsage = Array.isArray(nevaSummary?.bucket_usage) ? nevaSummary.bucket_usage : []
  const nevaBucketSnapshots = Array.isArray(nevaPlatform?.bucket_snapshots) ? nevaPlatform.bucket_snapshots : []

  const tenants = useMemo(() => (
    Array.isArray(superSummary?.tenants) ? superSummary.tenants : []
  ), [superSummary])
  const nevaBucketSnapshotMap = useMemo(() => new Map(
    nevaBucketSnapshots.map((item) => [item.logical_bucket, item])
  ), [nevaBucketSnapshots])
  const nevaBucketRows = useMemo(() => {
    const usageRows = nevaBucketUsage.length > 0
      ? nevaBucketUsage
      : Object.keys(nevaBucketMap).map((bucket) => ({
        bucket,
        label: NEVA_BUCKET_LABELS[bucket] || bucket,
        bytes: 0,
        bytes_label: '0 B',
        files: 0,
        quota_label: nevaQuota?.quota_label || 'Tidak dibatasi',
        remaining_after_bucket_label: nevaQuota?.quota_label || 'Tidak dibatasi',
        remaining_after_provider_label: nevaQuota?.remaining_label || 'Tidak dibatasi',
        percent: null
      }))

    return usageRows.map((row) => {
      const snapshot = nevaBucketSnapshotMap.get(row.bucket) || {}
      return {
        ...row,
        physical_bucket: nevaBucketMap[row.bucket] || snapshot.physical_bucket || row.bucket,
        snapshot_total_label: snapshot.total_label || null,
        snapshot_untracked_label: snapshot.untracked_label || null,
        snapshot_scanned_at: snapshot.scanned_at || null
      }
    })
  }, [
    nevaBucketMap,
    nevaBucketSnapshotMap,
    nevaBucketUsage,
    nevaQuota?.quota_label,
    nevaQuota?.remaining_label
  ])
  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId)
  const selectedTenantName = selectedTenant?.name || tenantDetail?.tenant?.name || 'Sekolah dipilih'
  const canManageStorageScope = !isSuperAdmin || Boolean(selectedTenantId)
  const activePeriod = activeSummary?.active_period || {}
  const periodOptions = useMemo(() => {
    const map = new Map()
    const addPeriod = (tahunAjaran, semester, meta = {}) => {
      const value = periodValue(tahunAjaran, semester)
      const rank = periodRank(tahunAjaran, semester)
      if (!value || rank === null) return
      const existing = map.get(value) || {
        value,
        tahun_ajaran: tahunAjaran,
        semester,
        rank,
        bytes_label: '',
        files: 0,
        isActive: false
      }
      map.set(value, {
        ...existing,
        bytes_label: meta.bytes_label || meta.uploaded_label || existing.bytes_label,
        files: Number(meta.files ?? existing.files ?? 0),
        isActive: existing.isActive || Boolean(meta.isActive)
      })
    }

    addPeriod(activePeriod?.tahun_ajaran, activePeriod?.semester, { isActive: true })
    periodCatalog.forEach((item) => addPeriod(item.tahun_ajaran, item.semester, item))
    periods.forEach((item) => addPeriod(item.tahun_ajaran, item.semester, item))

    return Array.from(map.values()).sort((a, b) => b.rank - a.rank)
  }, [
    activePeriod?.semester,
    activePeriod?.tahun_ajaran,
    periodCatalog,
    periods
  ])
  const safeCleanupPeriodOptions = useMemo(() => {
    const activeRank = periodRank(activePeriod?.tahun_ajaran, activePeriod?.semester)
    if (activeRank === null) return []
    return periodOptions.filter((item) => activeRank - item.rank >= 1)
  }, [activePeriod?.semester, activePeriod?.tahun_ajaran, periodOptions])
  const cleanupPeriodValue = periodValue(cleanupForm.tahun_ajaran, cleanupForm.semester)
  const cleanupPeriodIsAllowed = safeCleanupPeriodOptions.some((item) => item.value === cleanupPeriodValue)
  const cleanupHasRequiredPeriod = Boolean(cleanupPeriodValue && cleanupPeriodIsAllowed)
  const cleanupHasProviderBucket = Boolean(cleanupForm.provider && cleanupForm.bucket)
  const cleanupReady = cleanupHasRequiredPeriod && cleanupHasProviderBucket

  const loadAdminSummary = async (filters = storageFilters) => {
    const { data, error } = await supabase.admin.storageManager(filters)
    if (error) throw error
    setSummary(data || null)
  }

  const loadSuperSummary = async () => {
    const { data, error } = await supabase.super.storageOverview()
    if (error) throw error
    setSuperSummary(data || null)
    const firstTenant = data?.tenants?.[0]?.id
    const tenantIds = new Set((data?.tenants || []).map((tenant) => tenant.id).filter(Boolean))
    setSelectedTenantId((current) => (current && tenantIds.has(current) ? current : firstTenant || ''))
  }

  const updateCleanupForm = (patch) => {
    setCleanupPreview(null)
    setCleanupForm((prev) => ({ ...prev, ...patch }))
  }

  const fetchTenantDetail = async (tenantId, filters = storageFilters) => {
    const { data, error } = await supabase.super.tenantStorage(tenantId, filters)
    if (error) throw error
    return data || null
  }

  const applyTenantDetail = (data) => {
    setTenantDetail(data || null)
    const providerQuotas = data?.quota?.providers || data?.providers || {}
    const vps = providerQuotas?.vps || {}
    const neva = providerQuotas?.neva_s3 || {}
    setQuotaForm({
      vpsQuotaGb: bytesToGbInput(vps?.quota_bytes ?? data?.quota?.quota_bytes),
      nevaQuotaGb: bytesToGbInput(neva?.quota_bytes),
      notes: data?.quota?.notes || ''
    })
  }

  const reloadActiveStorage = async () => {
    if (isSuperAdmin) {
      await loadSuperSummary()
      if (selectedTenantId) {
        const data = await fetchTenantDetail(selectedTenantId, storageFilters)
        applyTenantDetail(data)
      }
      return
    }

    await loadAdminSummary(storageFilters)
  }

  const refresh = async () => {
    setLoading(true)
    setStorageError('')
    try {
      if (isSuperAdmin) {
        await loadSuperSummary()
        if (selectedTenantId) {
          const data = await fetchTenantDetail(selectedTenantId, storageFilters)
          applyTenantDetail(data)
        }
      } else {
        await loadAdminSummary(storageFilters)
      }
    } catch (error) {
      const message = error?.message || 'Gagal memuat storage manager'
      setStorageError(message)
      pushToast('error', message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!superAdminChecked) return
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [superAdminChecked, isSuperAdmin])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (activeTab === 'neva') url.searchParams.set('tab', 'neva')
    else url.searchParams.delete('tab')
    if (selectedTenantId) url.searchParams.set('tenant', selectedTenantId)
    else url.searchParams.delete('tenant')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }, [activeTab, selectedTenantId])

  useEffect(() => {
    setCleanupPreview(null)
    setCleanupForm((prev) => ({
      ...prev,
      provider: activeTab === 'neva' ? 'object_storage' : 'local'
    }))
  }, [activeTab])

  useEffect(() => {
    if (!isSuperAdmin || !selectedTenantId) return
    let alive = true
    fetchTenantDetail(selectedTenantId, storageFilters)
      .then((data) => {
        if (!alive) return
        applyTenantDetail(data)
      })
      .catch((error) => pushToast('error', error?.message || 'Gagal memuat detail storage sekolah'))
    return () => { alive = false }
  }, [isSuperAdmin, selectedTenantId, pushToast])

  const handlePreviewCleanup = async () => {
    if (!cleanupHasProviderBucket) {
      pushToast('warning', 'Pilih provider dan bucket storage terlebih dahulu.')
      return
    }
    if (!cleanupHasRequiredPeriod) {
      pushToast('warning', 'Pilih tahun ajaran dan semester yang sudah lewat minimal 1 semester dulu.')
      return
    }
    setCleanupLoading(true)
    try {
      const api = isSuperAdmin
        ? supabase.super.superStorageCleanupPreview(selectedTenantId, cleanupForm)
        : supabase.admin.storageCleanupPreview(cleanupForm)
      const { data, error } = await api
      if (error) throw error
      setCleanupPreview(data)
      pushToast(data?.allowed ? 'success' : 'warning', data?.message || 'Preview cleanup selesai')
    } catch (error) {
      pushToast('error', error?.message || 'Gagal membuat preview cleanup')
    } finally {
      setCleanupLoading(false)
    }
  }

  const handleExecuteCleanup = async () => {
    if (!cleanupHasProviderBucket) {
      pushToast('warning', 'Cleanup wajib memilih provider dan bucket storage.')
      return
    }
    if (!cleanupHasRequiredPeriod) {
      pushToast('warning', 'Cleanup wajib memakai tahun ajaran dan semester yang sudah lewat minimal 1 semester.')
      return
    }
    if (!cleanupPreview?.allowed || cleanupPreview.files <= 0) {
      pushToast('warning', 'Jalankan preview cleanup dulu')
      return
    }
    const confirmed = window.confirm(`Pindahkan ${cleanupPreview.files} file (${cleanupPreview.bytes_label}) ke Trash?`)
    if (!confirmed) return

    setCleanupLoading(true)
    try {
      const payload = { ...cleanupForm, backup: true }
      const api = isSuperAdmin
        ? supabase.super.superStorageCleanupExecute(selectedTenantId, payload)
        : supabase.admin.storageCleanupExecute(payload)
      const { data, error } = await api
      if (error) throw error
      pushToast('success', `${data?.files || 0} file dipindahkan ke Trash`)
      setCleanupPreview(null)
      await reloadActiveStorage()
    } catch (error) {
      pushToast('error', error?.message || 'Cleanup gagal')
    } finally {
      setCleanupLoading(false)
    }
  }

  const handleSyncObjectStorage = async (tenantIdOverride = selectedTenantId, options = {}) => {
    const syncTenantId = tenantIdOverride || ''
    setSyncingObjectStorage(true)
    try {
      const payload = {
        bucket: options.bucket ?? cleanupForm.bucket ?? '',
        max_pages: isSuperAdmin ? 10 : 5
      }
      const api = isSuperAdmin
        ? syncTenantId
          ? supabase.super.syncTenantObjectStorage(syncTenantId, payload)
          : supabase.super.syncObjectStorage(payload)
        : supabase.admin.syncObjectStorage(payload)
      const { data, error } = await api
      if (error) throw error

      pushToast(
        data?.ok === false ? 'warning' : 'success',
        data?.message
          ? `${data.message} Terbaca ${data.total_label || '0 B'}, belum terlacak ${data.untracked_label || '0 B'}.`
          : 'Sync Neva S3 selesai'
      )
      await reloadActiveStorage()
    } catch (error) {
      pushToast('error', error?.message || 'Gagal sync inventaris Neva S3')
    } finally {
      setSyncingObjectStorage(false)
    }
  }

  const handleSaveQuota = async () => {
    if (!selectedTenantId) return
    setSavingQuota(true)
    try {
      const vpsQuotaBytes = toBytesFromGb(quotaForm.vpsQuotaGb)
      const payload = {
        quota_bytes: vpsQuotaBytes,
        vps_quota_bytes: vpsQuotaBytes,
        neva_s3_quota_bytes: toBytesFromGb(quotaForm.nevaQuotaGb),
        notes: quotaForm.notes
      }
      const { error } = await supabase.super.updateTenantStorageQuota(selectedTenantId, payload)
      if (error) throw error
      pushToast('success', 'Kuota storage sekolah disimpan')
      await reloadActiveStorage()
    } catch (error) {
      pushToast('error', error?.message || 'Gagal menyimpan kuota')
    } finally {
      setSavingQuota(false)
    }
  }

  const handleRestoreTrashFile = async (fileId) => {
    if (!fileId) return
    setRestoringTrashId(fileId)
    try {
      const api = isSuperAdmin
        ? supabase.super.restoreStorageTrash(selectedTenantId, fileId)
        : supabase.admin.restoreStorageTrash(fileId)
      const { error } = await api
      if (error) throw error
      pushToast('success', 'File berhasil dipulihkan dari Trash')
      await reloadActiveStorage()
    } catch (error) {
      pushToast('error', error?.message || 'Gagal memulihkan file')
    } finally {
      setRestoringTrashId('')
    }
  }

  const handlePurgeExpiredTrash = async () => {
    if (!isSuperAdmin) return
    const confirmed = window.confirm('Hapus permanen file Trash yang sudah kedaluwarsa lebih dari 30 hari?')
    if (!confirmed) return

    setPurgingTrash(true)
    try {
      const { data, error } = await supabase.super.purgeExpiredStorageTrash()
      if (error) throw error
      pushToast('success', `${data?.files || 0} file Trash kedaluwarsa dipurge`)
      await reloadActiveStorage()
    } catch (error) {
      pushToast('error', error?.message || 'Gagal purge Trash kedaluwarsa')
    } finally {
      setPurgingTrash(false)
    }
  }

  const loadStorageWithFilters = async (nextFilters) => {
    setLoading(true)
    setStorageError('')
    try {
      setStorageFilters(nextFilters)
      setCleanupPreview(null)
      setCleanupForm((prev) => ({
        ...prev,
        tahun_ajaran: nextFilters.tahun_ajaran,
        semester: nextFilters.semester,
        category: ['tugas', 'kuis', 'lampiran'].includes(nextFilters.category) ? nextFilters.category : ''
      }))
      if (isSuperAdmin) {
        if (selectedTenantId) {
          const data = await fetchTenantDetail(selectedTenantId, nextFilters)
          applyTenantDetail(data)
        } else {
          await loadSuperSummary()
        }
      } else {
        await loadAdminSummary(nextFilters)
      }
    } catch (error) {
      const message = error?.message || 'Gagal menerapkan filter storage'
      setStorageError(message)
      pushToast('error', message)
    } finally {
      setLoading(false)
    }
  }

  const handleApplyStorageFilters = () => {
    loadStorageWithFilters(storageFilterDraft)
  }

  const handleResetStorageFilters = () => {
    const next = { tahun_ajaran: '', semester: '', category: '' }
    setStorageFilterDraft(next)
    loadStorageWithFilters(next)
  }

  const cleanupSection = (
    <section className="rounded-lg border border-rose-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <h2 className="text-sm font-bold text-slate-900">Cleanup Aman ke Trash</h2>
          <p className="mt-1 text-xs text-slate-500">
            Cleanup hanya memindahkan file storage tugas, quiz, dan lampiran ke Trash. Data tugas, quiz, nilai, siswa, guru, dan record penting tetap aman.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">Trash 30 hari</span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-semibold text-amber-800">Minimal 3 bulan</span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Target cleanup</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="block text-xs font-semibold text-slate-600">
              Provider
              <select
                value={cleanupForm.provider}
                onChange={(event) => updateCleanupForm({ provider: event.target.value })}
                className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {CLEANUP_PROVIDER_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Bucket
              <select
                value={cleanupForm.bucket}
                onChange={(event) => updateCleanupForm({ bucket: event.target.value })}
                className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {CLEANUP_BUCKET_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Periode selesai
              <select
                value={cleanupPeriodValue}
                onChange={(event) => updateCleanupForm(parsePeriodValue(event.target.value))}
                className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">Pilih periode lama</option>
                {safeCleanupPeriodOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.tahun_ajaran} - {item.semester}{item.bytes_label ? ` (${item.bytes_label})` : ''}
                  </option>
                ))}
                {safeCleanupPeriodOptions.length === 0 && (
                  <option value="" disabled>Belum ada semester lama yang aman</option>
                )}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Kategori
              <select
                value={cleanupForm.category}
                onChange={(e) => updateCleanupForm({ category: e.target.value })}
                className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {CLEANUP_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Umur file
              <select
                value={cleanupForm.older_than_days}
                onChange={(e) => updateCleanupForm({ older_than_days: e.target.value })}
                className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {CLEANUP_AGE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Prioritas ukuran
              <select
                value={cleanupForm.largest_percent}
                onChange={(e) => updateCleanupForm({ largest_percent: e.target.value })}
                className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {CLEANUP_PERCENT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Pengaman aktif</h3>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            {[
              'Tidak bisa untuk semester aktif',
              'Tidak bisa untuk file di bawah 3 bulan',
              'Hanya bucket assignments dan quiz-media',
              'Hanya dokumen/gambar tugas atau quiz',
              'Preview wajib sebelum pindah ke Trash'
            ].map((item) => (
              <div key={item} className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-600" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={handlePreviewCleanup}
          disabled={cleanupLoading || !cleanupReady || (isSuperAdmin && !selectedTenantId)}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
        >
          <Trash2 size={16} />
          {cleanupLoading ? 'Memproses...' : 'Preview Cleanup'}
        </button>
        <button
          type="button"
          onClick={handleExecuteCleanup}
          disabled={cleanupLoading || !cleanupReady || !cleanupPreview?.allowed || cleanupPreview?.files <= 0}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
        >
          Pindahkan ke Trash
        </button>
      </div>

      {!cleanupHasProviderBucket && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Pilih provider dan bucket terlebih dahulu supaya cleanup hanya menyasar lokasi storage yang benar.
        </div>
      )}
      {cleanupHasProviderBucket && !cleanupHasRequiredPeriod && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Pilih periode lama dari dropdown. Cleanup tidak bisa untuk semester aktif, semester berjalan, atau data yang belum lewat minimal satu semester.
        </div>
      )}
      {cleanupPreview && (
        <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${cleanupPreview.allowed ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          {cleanupPreview.message} Kandidat: {numberFormatter.format(cleanupPreview.files || 0)} file ({cleanupPreview.bytes_label || '0 B'}).
        </div>
      )}
    </section>
  )

  if (!superAdminChecked) {
    return <div className="p-6 text-sm text-slate-500">Memuat akses storage manager...</div>
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 md:px-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">Storage Manager</p>
            <h1 className="text-2xl font-bold text-slate-950">
              Storage VPS & Neva Cloud S3
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Kelola kuota VPS, kuota Neva Cloud S3, inventaris file, rekomendasi cleanup, dan Trash dari satu halaman.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isSuperAdmin && (
              <button
                type="button"
                onClick={handlePurgeExpiredTrash}
                disabled={purgingTrash}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 shadow-sm hover:bg-rose-50 disabled:opacity-60"
              >
                <Trash2 size={16} />
                {purgingTrash ? 'Memproses...' : 'Purge Trash'}
              </button>
            )}
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab('storage')}
            className={`inline-flex min-w-max items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold ${activeTab === 'storage' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <HardDrive size={16} />
            VPS Storage
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('neva')}
            className={`inline-flex min-w-max items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold ${activeTab === 'neva' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <Cloud size={16} />
            Neva Cloud S3
          </button>
        </div>

        {storageError && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-bold">Storage belum bisa dimuat sempurna</p>
                <p className="mt-1 text-amber-800">{storageError}</p>
              </div>
              <button
                type="button"
                onClick={refresh}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                Coba lagi
              </button>
            </div>
          </section>
        )}

        {isSuperAdmin && (
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Sekolah Aktif Dikelola</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Pilih sekolah di sini untuk mengelola kuota VPS, kuota Neva S3, cleanup, dan Trash tanpa kembali ke halaman Sekolah.
                </p>
              </div>
              <select
                value={selectedTenantId}
                onChange={(event) => setSelectedTenantId(event.target.value)}
                className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 lg:max-w-md"
              >
                <option value="">Pilih sekolah</option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name} ({tenant.slug})
                  </option>
                ))}
              </select>
            </div>
            {selectedTenantId && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-indigo-50 px-3 py-1 font-semibold text-indigo-700">{selectedTenantName}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-600">{tenantDetail?.tenant?.slug || selectedTenant?.slug || selectedTenantId}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-600">Status: {tenantDetail?.tenant?.status || selectedTenant?.status || '-'}</span>
              </div>
            )}
          </section>
        )}

        {activeTab === 'neva' && isSuperAdmin && (
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Platform Neva Cloud S3</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Total paket Neva diambil dari ENV server. Setelah sekolah dipilih, Super Admin membagi jatah sekolah lewat field Kuota Neva S3.
                </p>
                {nevaPlatform?.last_scanned_at && (
                  <p className="mt-1 text-xs text-slate-400">Scan terakhir: {formatDateTime(nevaPlatform.last_scanned_at)}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleSyncObjectStorage('', { bucket: '' })}
                disabled={syncingObjectStorage || !nevaEnabled}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-60"
              >
                <RefreshCw size={16} className={syncingObjectStorage ? 'animate-spin' : ''} />
                {syncingObjectStorage ? 'Membaca S3...' : 'Scan Platform'}
              </button>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatTile icon={Cloud} label="Total Paket Neva S3" value={nevaPlatform?.capacity_label || 'Belum diset'} hint="APP_OBJECT_STORAGE_CAPACITY_GB" />
              <StatTile icon={Database} label="Terpakai Platform" value={nevaPlatform?.used_label || '0 B'} hint={nevaPlatform?.percent !== null && nevaPlatform?.percent !== undefined ? `${nevaPlatform.percent}% paket` : 'Menunggu scan bucket'} />
              <StatTile icon={ShieldCheck} label="Kuota S3 Dibagikan" value={nevaPlatform?.allocated_quota_label || '0 B'} />
              <StatTile icon={Archive} label="Sisa Setelah Kuota" value={nevaPlatform?.remaining_after_allocated_label || 'Belum diset'} />
            </div>
            {(nevaPlatform?.tracked_label || nevaPlatform?.untracked_label) && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  Terlacak aplikasi: <span className="font-bold">{nevaPlatform.tracked_label || '0 B'}</span>
                </div>
                <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Belum terlacak metadata: <span className="font-bold">{nevaPlatform.untracked_label || '0 B'}</span>
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === 'neva' && (!isSuperAdmin || selectedTenantId) && (
          <section className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatTile icon={Cloud} label="Status Neva S3" value={nevaEnabled ? 'Aktif' : 'Belum aktif'} hint={nevaPlatform?.endpoint || 'Endpoint Neva Cloud S3'} />
              <StatTile icon={Database} label="Terpakai S3 Sekolah" value={nevaQuota?.used_label || nevaSummary?.usage?.total_label || '0 B'} hint={`${numberFormatter.format(nevaSummary?.usage?.total_files || 0)} file`} />
              <StatTile icon={ShieldCheck} label="Kuota S3 Sekolah" value={nevaQuota?.quota_label || 'Tidak dibatasi'} hint={providerPercentLabel(nevaQuota)} />
              <StatTile icon={Archive} label="Sisa S3 Sekolah" value={nevaQuota?.remaining_label || 'Tidak dibatasi'} />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold text-slate-900">Monitoring Neva Cloud S3</h2>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${providerBadgeClass(nevaEnabled)}`}>
                        {nevaEnabled ? 'Provider aktif' : 'Provider belum aktif'}
                      </span>
                      {nevaDirectEnabled && (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                          Direct upload aktif
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Upload harian tugas, media quiz, dan file sertifikat diarahkan ke Neva Cloud S3. Arsip dan backup bisa dikelola terpisah dari jalur upload cepat.
                    </p>
                    {nevaPlatform?.last_scanned_at && (
                      <p className="mt-1 text-xs text-slate-400">
                        Scan platform terakhir: {formatDateTime(nevaPlatform.last_scanned_at)}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleSyncObjectStorage}
                    disabled={syncingObjectStorage || !nevaEnabled}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-60"
                  >
                    <RefreshCw size={16} className={syncingObjectStorage ? 'animate-spin' : ''} />
                    {syncingObjectStorage ? 'Membaca S3...' : selectedTenantId ? 'Scan S3 Sekolah' : 'Scan S3 Platform'}
                  </button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {[
                    ['Provider S3', nevaEnabled, nevaPlatform?.label || 'Neva Cloud S3'],
                    ['Endpoint', Boolean(nevaPlatform?.endpoint), nevaPlatform?.endpoint || 'Endpoint diambil dari ENV server'],
                    ['Direct upload browser', nevaDirectEnabled, nevaDirectEnabled ? 'File langsung ke S3 saat CORS bucket siap' : 'Fallback backend tetap aman'],
                    ['Verifikasi object', Boolean(nevaPlatform?.verify_objects), nevaPlatform?.verify_objects ? 'Object diverifikasi setelah upload' : 'Verifikasi opsional belum aktif']
                  ].map(([label, ok, detail]) => (
                    <div key={label} className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
                      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 text-slate-400" />}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{label}</p>
                        <p className="truncate text-xs text-slate-500">{detail}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {nevaQuota?.percent !== null && nevaQuota?.percent !== undefined && (
                  <div className="mt-4">
                    <ProgressLine label={`Pemakaian kuota S3 ${selectedTenantName}`} value={`${nevaQuota.percent}%`} percent={nevaQuota.percent} />
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-bold text-slate-900">Bucket Neva Aktif</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Setiap bucket memakai kuota Neva S3 sekolah. Sisa kuota dihitung dari jatah Neva sekolah, bukan dari VPS.
                </p>
                <div className="mt-3 space-y-3">
                  {nevaBucketRows.map((bucket) => (
                    <div key={bucket.bucket} className="rounded-lg border border-slate-100 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{bucket.label || NEVA_BUCKET_LABELS[bucket.bucket] || bucket.bucket}</p>
                          <p className="truncate text-xs text-slate-500">{bucket.physical_bucket || bucket.bucket}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">
                          {bucket.bytes_label || '0 B'}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                        <span>{numberFormatter.format(bucket.files || 0)} file sekolah</span>
                        <span>Sisa sekolah: {bucket.remaining_after_provider_label || 'Tidak dibatasi'}</span>
                        <span>Kuota sekolah: {bucket.quota_label || 'Tidak dibatasi'}</span>
                        <span>Sisa jika bucket ini saja: {bucket.remaining_after_bucket_label || 'Tidak dibatasi'}</span>
                      </div>
                      {bucket.percent !== null && bucket.percent !== undefined && (
                        <div className="mt-3">
                          <ProgressLine label="Porsi bucket terhadap kuota sekolah" value={`${bucket.percent}%`} percent={bucket.percent} />
                        </div>
                      )}
                      {(bucket.snapshot_total_label || bucket.snapshot_untracked_label) && (
                        <p className="mt-3 text-xs text-slate-400">
                          Scan Neva: total {bucket.snapshot_total_label || '0 B'}, belum terlacak {bucket.snapshot_untracked_label || '0 B'}.
                        </p>
                      )}
                    </div>
                  ))}
                  {nevaBucketRows.length === 0 && (
                    <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                      Bucket Neva belum terbaca. Jalankan scan S3 setelah konfigurasi ENV aktif.
                    </p>
                  )}
                </div>
              </section>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <BarChart3 size={18} className="text-indigo-600" />
                  <h2 className="text-sm font-bold text-slate-900">Analitik Neva S3</h2>
                </div>
                <div className="space-y-4">
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Kategori terbesar</h3>
                    {categories.map((item) => (
                      <ProgressLine
                        key={item.category}
                        label={item.label}
                        value={item.bytes_label}
                        percent={usage.total_bytes ? (item.bytes / usage.total_bytes) * 100 : 0}
                      />
                    ))}
                    {categories.length === 0 && <p className="text-sm text-slate-500">Belum ada file S3 pada filter ini.</p>}
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Periode terbesar</h3>
                    {periods.slice(0, 6).map((item) => (
                      <ProgressLine
                        key={`${item.tahun_ajaran}-${item.semester}`}
                        label={`${item.tahun_ajaran || '-'} ${item.semester || ''}`}
                        value={item.bytes_label}
                        percent={usage.total_bytes ? (item.bytes / usage.total_bytes) * 100 : 0}
                      />
                    ))}
                    {periods.length === 0 && <p className="text-sm text-slate-500">Belum ada data periode S3.</p>}
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-bold text-slate-900">File Terbesar di Neva S3</h2>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    <FileText size={14} />
                    {numberFormatter.format(largestFiles.length)} file
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {largestFiles.map((file) => (
                    <div key={file.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{file.file_name}</p>
                        <p className="text-xs text-slate-500">{file.category_label} · {formatDateTime(file.uploaded_at)}</p>
                      </div>
                      <span className="shrink-0 text-sm font-bold text-slate-700">{file.size_label}</span>
                    </div>
                  ))}
                  {largestFiles.length === 0 && <p className="text-sm text-slate-500">Belum ada file S3 tercatat.</p>}
                </div>
              </section>
            </div>
          </section>
        )}

        {activeTab === 'neva' && isSuperAdmin && !selectedTenantId && (
          <section className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
            <Cloud className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-3 text-base font-bold text-slate-900">Pilih sekolah dulu</h2>
            <p className="mt-1 text-sm text-slate-500">
              Neva Cloud S3 dikelola per sekolah. Pilih tenant dari dropdown di atas untuk melihat kuota, pemakaian, kategori, dan file terbesar.
            </p>
            <button
              type="button"
              onClick={handleSyncObjectStorage}
              disabled={syncingObjectStorage || !nevaEnabled}
              className="mx-auto mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-60"
            >
              <RefreshCw size={16} className={syncingObjectStorage ? 'animate-spin' : ''} />
              {syncingObjectStorage ? 'Membaca S3...' : 'Scan Semua Bucket Neva'}
            </button>
          </section>
        )}

        {activeTab === 'storage' && (
          <>
        {isSuperAdmin && (
          <div className="grid gap-4 lg:grid-cols-4">
            <StatTile icon={HardDrive} label="Total VPS" value={superSummary?.server?.total_label} />
            <StatTile icon={Database} label="Terpakai VPS" value={superSummary?.server?.used_label} hint={`${superSummary?.server?.disk_percent || 0}% disk`} />
            <StatTile icon={ShieldCheck} label="Kuota Dibagikan" value={superSummary?.server?.allocated_quota_label} />
            <StatTile icon={Archive} label="Sisa Setelah Kuota" value={superSummary?.server?.remaining_after_allocated_label} />
          </div>
        )}

        {isSuperAdmin && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">Monitoring Semua Sekolah</h2>
                <span className="text-xs text-slate-500">{numberFormatter.format(tenants.length)} sekolah</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
	                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
	                    <tr>
	                      <th className="py-2 pr-3">Sekolah</th>
	                      <th className="py-2 pr-3">VPS</th>
	                      <th className="py-2 pr-3">Neva S3</th>
	                      <th className="py-2 pr-3">Kuota</th>
	                      <th className="py-2 pr-3">Kategori</th>
	                    </tr>
	                  </thead>
		                  <tbody>
		                    {tenants.map((tenant) => {
		                      const tenantProviders = tenant.providers || tenant.quota?.providers || {}
		                      const tenantVps = tenantProviders.vps || {}
		                      const tenantNeva = tenantProviders.neva_s3 || {}
	                      return (
	                        <tr
	                          key={tenant.id}
	                          onClick={() => setSelectedTenantId(tenant.id)}
	                          className={`cursor-pointer border-t border-slate-100 ${selectedTenantId === tenant.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
	                        >
	                          <td className="py-3 pr-3">
	                            <p className="font-semibold text-slate-900">{tenant.name}</p>
	                            <p className="text-xs text-slate-500">{tenant.slug}</p>
	                          </td>
	                          <td className="py-3 pr-3">
	                            <p className="font-medium text-slate-700">{tenantVps.used_label || tenant.usage?.total_label || '0 B'}</p>
	                            <p className="text-xs text-slate-500">{tenantVps.quota_label || 'Tanpa batas'}</p>
	                          </td>
	                          <td className="py-3 pr-3">
	                            <p className="font-medium text-slate-700">{tenantNeva.used_label || '0 B'}</p>
	                            <p className="text-xs text-slate-500">{tenantNeva.quota_label || 'Tanpa batas'}</p>
	                          </td>
	                          <td className="py-3 pr-3 text-slate-600">{tenant.quota?.quota_label || tenantVps.quota_label || '-'}</td>
	                          <td className="py-3 pr-3 text-slate-600">{tenant.top_category?.label || '-'}</td>
	                        </tr>
	                      )
	                    })}
	                  </tbody>
	                </table>
              </div>
            </section>

	            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
	              <h2 className="text-sm font-bold text-slate-900">Kuota Sekolah</h2>
	              <p className="mt-1 text-xs text-slate-500">
	                {selectedTenant?.name || 'Pilih sekolah dari tabel.'} Kuota VPS dan Neva S3 dikelola sebagai total jatah sekolah. Upload per-file tidak dibatasi dari panel ini.
	              </p>
	              <p className="mt-1 text-xs text-indigo-600">
	                Contoh: paket Neva platform 100 GB, sekolah ini diberi 40 GB. Sisa platform otomatis terlihat di kartu Neva S3.
	              </p>
	              <div className="mt-4 grid gap-3">
	                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
	                  <label className="block text-xs font-semibold text-slate-600">
	                    Kuota VPS (GB)
	                    <input
	                      type="number"
	                      min="0"
	                      step="0.1"
	                      value={quotaForm.vpsQuotaGb}
	                      onChange={(e) => setQuotaForm((prev) => ({ ...prev, vpsQuotaGb: e.target.value }))}
	                      placeholder="contoh: 20"
	                      className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
	                    />
	                  </label>
	                  <label className="block text-xs font-semibold text-slate-600">
	                    Kuota Neva S3 (GB)
	                    <input
	                      type="number"
	                      min="0"
	                      step="0.1"
	                      value={quotaForm.nevaQuotaGb}
	                      onChange={(e) => setQuotaForm((prev) => ({ ...prev, nevaQuotaGb: e.target.value }))}
	                      placeholder="contoh: 40"
	                      className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
	                    />
	                    <span className="mt-1 block text-[11px] font-normal text-slate-500">
	                      Dipakai untuk tugas, media quiz, sertifikat, dan bucket object storage lain.
	                    </span>
	                  </label>
	                </div>
	                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
	                  Storage Manager tidak memasang batas ukuran per-file. Pengaman kapasitas hanya berjalan berdasarkan total kuota sekolah.
	                </div>
	                <label className="block text-xs font-semibold text-slate-600">
	                  Catatan
	                  <textarea
	                    value={quotaForm.notes}
	                    onChange={(e) => setQuotaForm((prev) => ({ ...prev, notes: e.target.value }))}
	                    rows={3}
	                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
	                  />
	                </label>
	                <button
	                  type="button"
	                  disabled={!selectedTenantId || savingQuota}
	                  onClick={handleSaveQuota}
	                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
	                >
	                  <Save size={16} />
	                  {savingQuota ? 'Menyimpan...' : 'Simpan Kuota'}
	                </button>
	              </div>
	            </section>
          </div>
        )}

	        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
	          <StatTile icon={HardDrive} label="VPS Terpakai" value={usage.total_label || quota.used_label} hint={`${numberFormatter.format(usage.total_files || 0)} file`} />
	          <StatTile icon={Database} label="Kuota VPS" value={quota.quota_label} hint={quota.percent !== null && quota.percent !== undefined ? `${quota.percent}% terpakai` : 'Belum dibatasi'} />
	          <StatTile icon={Archive} label="Sisa VPS" value={quota.remaining_label} />
	          <StatTile icon={Trash2} label="Trash" value={activeSummary?.trash?.bytes_label || '0 B'} hint={`${numberFormatter.format(activeSummary?.trash?.files || 0)} file`} />
	        </div>

	        {quota.percent !== null && quota.percent !== undefined && (
	          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
	            <ProgressLine label="Pemakaian kuota VPS sekolah" value={`${quota.percent}%`} percent={quota.percent} />
	          </section>
	        )}

        {activeBucketRows.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-bold text-slate-900">Bucket VPS Sekolah</h2>
              <p className="text-xs text-slate-500">
                Bucket ini memakai kuota VPS sekolah. Cleanup aman hanya tersedia untuk bucket tugas dan media quiz.
              </p>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {activeBucketRows.map((bucket) => (
                <div key={bucket.bucket} className="rounded-lg border border-slate-100 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{bucket.label || NEVA_BUCKET_LABELS[bucket.bucket] || bucket.bucket}</p>
                      <p className="text-xs text-slate-500">{numberFormatter.format(bucket.files || 0)} file</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                      {bucket.bytes_label || '0 B'}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                    <span>Kuota sekolah: {bucket.quota_label || 'Tidak dibatasi'}</span>
                    <span>Sisa sekolah: {bucket.remaining_after_provider_label || 'Tidak dibatasi'}</span>
                    <span>Sisa jika bucket ini saja: {bucket.remaining_after_bucket_label || 'Tidak dibatasi'}</span>
                  </div>
                  {bucket.percent !== null && bucket.percent !== undefined && (
                    <div className="mt-3">
                      <ProgressLine label="Porsi bucket terhadap kuota sekolah" value={`${bucket.percent}%`} percent={bucket.percent} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Filter Storage</h2>
              <p className="mt-1 text-xs text-slate-500">
                Filter ini dipakai untuk analitik, file terbesar, uploader, rekomendasi, dan preview cleanup.
              </p>
            </div>
            <div className="grid w-full gap-2 sm:grid-cols-2 lg:max-w-3xl lg:grid-cols-[1fr_180px_auto_auto]">
              <select
                value={periodValue(storageFilterDraft.tahun_ajaran, storageFilterDraft.semester)}
                onChange={(event) => setStorageFilterDraft((prev) => ({
                  ...prev,
                  ...parsePeriodValue(event.target.value)
                }))}
                className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Semua periode</option>
                {periodOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.tahun_ajaran} - {item.semester}{item.isActive ? ' (Aktif)' : ''}
                  </option>
                ))}
                {periodOptions.length === 0 && <option value="" disabled>Belum ada periode tercatat</option>}
              </select>
              <select
                value={storageFilterDraft.category}
                onChange={(event) => setStorageFilterDraft((prev) => ({ ...prev, category: event.target.value }))}
                className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <button
                type="button"
                onClick={handleApplyStorageFilters}
                disabled={loading}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                Terapkan
              </button>
              <button
                type="button"
                onClick={handleResetStorageFilters}
                disabled={loading}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Reset
              </button>
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 size={18} className="text-indigo-600" />
              <h2 className="text-sm font-bold text-slate-900">Analitik Storage</h2>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Kategori terbesar</h3>
                {categories.map((item) => (
                  <ProgressLine
                    key={item.category}
                    label={item.label}
                    value={item.bytes_label}
                    percent={usage.total_bytes ? (item.bytes / usage.total_bytes) * 100 : 0}
                  />
                ))}
                {categories.length === 0 && <p className="text-sm text-slate-500">Belum ada metadata storage baru.</p>}
              </div>
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Periode paling besar</h3>
                {periods.slice(0, 6).map((item) => (
                  <ProgressLine
                    key={`${item.tahun_ajaran}-${item.semester}`}
                    label={`${item.tahun_ajaran || '-'} ${item.semester || ''}`}
                    value={item.bytes_label}
                    percent={usage.total_bytes ? (item.bytes / usage.total_bytes) * 100 : 0}
                  />
                ))}
                {periods.length === 0 && <p className="text-sm text-slate-500">Belum ada data periode.</p>}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-700" />
              <h2 className="text-sm font-bold text-slate-900">Rekomendasi</h2>
            </div>
            <div className="mt-3 space-y-2">
              {recommendations.map((item, index) => (
                <div key={`${item.type}-${index}`} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700">
                  {item.message}
                </div>
              ))}
              {recommendations.length === 0 && (
                <p className="text-sm text-slate-600">Belum ada rekomendasi kritikal.</p>
              )}
            </div>
          </section>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-slate-900">File Terbesar</h2>
            <div className="mt-3 space-y-2">
              {largestFiles.map((file) => (
                <div key={file.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{file.file_name}</p>
                    <p className="text-xs text-slate-500">{file.category_label} · {file.provider} · {formatDateTime(file.uploaded_at)}</p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-slate-700">{file.size_label}</span>
                </div>
              ))}
              {largestFiles.length === 0 && <p className="text-sm text-slate-500">Belum ada file tercatat.</p>}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-slate-900">Uploader Terbesar</h2>
            <div className="mt-3 space-y-2">
              {uploaders.map((user) => (
                <div key={user.user_id || user.nama} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{user.nama}</p>
                    <p className="text-xs text-slate-500">{user.role || '-'} · {numberFormatter.format(user.files || 0)} file</p>
                  </div>
                  <span className="text-sm font-bold text-slate-700">{user.bytes_label}</span>
                </div>
              ))}
              {uploaders.length === 0 && <p className="text-sm text-slate-500">Belum ada uploader tercatat.</p>}
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Trash Terbaru</h2>
              <p className="mt-1 text-xs text-slate-500">File di Trash dapat dipulihkan sebelum purge permanen setelah 30 hari.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {numberFormatter.format(activeSummary?.trash?.files || 0)} file
            </span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {trashFiles.map((file) => (
              <div key={file.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{file.file_name}</p>
                  <p className="text-xs text-slate-500">
                    {file.category_label} · {file.size_label} · kedaluwarsa {formatDateTime(file.trash_expires_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestoreTrashFile(file.id)}
                  disabled={restoringTrashId === file.id}
                  className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {restoringTrashId === file.id ? '...' : 'Restore'}
                </button>
              </div>
            ))}
            {trashFiles.length === 0 && <p className="text-sm text-slate-500">Trash masih kosong.</p>}
          </div>
        </section>

          </>
        )}

        {canManageStorageScope && cleanupSection}
      </div>
    </div>
  )
}

export default StorageManager
