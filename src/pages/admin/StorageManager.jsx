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
  X,
  XCircle
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'

const CLEANUP_PROVIDER_OPTIONS = [
  { value: 'object_storage', label: 'Neva Cloud S3' }
]

const CLEANUP_BUCKET_OPTIONS = [
  { value: '', label: 'Pilih bucket storage' },
  { value: 'assignments', label: 'Tugas / Assignments' },
  { value: 'quiz-media', label: 'Media Quiz' },
  { value: 'certificates', label: 'Sertifikat' },
  { value: 'sertifikat-files', label: 'File Sertifikat' }
]

const CLEANUP_AGE_OPTIONS = [
  { value: '2', label: 'Lebih dari 2 hari' },
  { value: '7', label: 'Lebih dari 7 hari' },
  { value: '30', label: 'Lebih dari 30 hari' },
  { value: '60', label: 'Lebih dari 2 bulan' },
  { value: '90', label: 'Lebih dari 90 hari' },
  { value: '180', label: 'Lebih dari 180 hari' },
  { value: '365', label: 'Lebih dari 1 tahun' }
]

const NEVA_BUCKET_LABELS = {
  'profile-photos': 'Logo & Foto Profil',
  assignments: 'Tugas',
  'quiz-media': 'Media Quiz',
  certificates: 'Sertifikat',
  'sertifikat-files': 'File Sertifikat',
  'certificate-templates': 'Template Sertifikat',
  'sertifikat-templates': 'Template Sertifikat'
}
const bucketLabel = (value) => NEVA_BUCKET_LABELS[value] || value || 'Semua bucket'

const numberFormatter = new Intl.NumberFormat('id-ID')
const formatBytesLabel = (bytes) => {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return '-'
  if (value < 1024) return `${numberFormatter.format(Math.round(value))} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value / 1024
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${numberFormatter.format(Math.round(size * 100) / 100)} ${units[unitIndex]}`
}
const toBytesFromGb = (value) => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.round(num * 1024 * 1024 * 1024) : null
}
const bytesToGbInput = (bytes) => bytes ? String(Math.round((Number(bytes) / 1024 / 1024 / 1024) * 100) / 100) : ''
const activeTabFromUrl = () => {
  return 'neva'
}
const selectedTenantFromUrl = () => {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('tenant') || ''
}
const storagePeriodValue = (tahunAjaran) => String(tahunAjaran || '')
const parseStoragePeriodValue = (value) => ({ tahun_ajaran: String(value || ''), semester: '' })
const providerPercentLabel = (quota) => (
  quota?.percent !== null && quota?.percent !== undefined ? `${quota.percent}%` : 'Belum dibatasi'
)

const providerBadgeClass = (enabled) => (
  enabled
    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : 'bg-amber-100 text-amber-800 border-amber-200'
)
const filterScopeLabel = (filters) => {
  const parts = []
  if (filters?.tahun_ajaran) {
    parts.push(filters.tahun_ajaran)
  }
  if (filters?.bucket) {
    parts.push(bucketLabel(filters.bucket))
  }
  return parts.length > 0 ? parts.join(' · ') : 'Semua metadata sekolah'
}

function StatTile({ icon: Icon, label, value, hint }) {
  return (
    <div className="group rounded-2xl border border-slate-100 bg-white p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 break-words text-xl font-semibold leading-tight text-slate-950 sm:text-2xl">{value || '-'}</p>
        </div>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 transition-colors group-hover:bg-indigo-100">
          <Icon size={18} />
        </span>
      </div>
      {hint ? <p className="mt-3 text-xs text-slate-500">{hint}</p> : null}
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

function TenantStorageCard({ tenant, selected, onClick }) {
  const providers = tenant.providers || tenant.quota?.providers || {}
  const neva = providers.neva_s3 || {}
  const nevaPercent = neva.percent !== null && neva.percent !== undefined ? Number(neva.percent) : null

  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[196px] rounded-2xl border bg-white p-5 text-left shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-card-hover ${selected ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-100'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-slate-950">{tenant.name || 'Sekolah'}</p>
          <p className="mt-1 truncate text-xs font-medium text-slate-500">{tenant.slug || tenant.id}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${tenant.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          {tenant.status || 'active'}
        </span>
      </div>

      <div className="mt-4">
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Neva S3</span>
            <span className="text-xs font-semibold text-slate-500">{nevaPercent !== null ? `${nevaPercent}%` : 'Bebas'}</span>
          </div>
          <p className="mt-1 text-sm font-bold text-slate-900">{neva.used_label || '0 B'}</p>
          <p className="mt-0.5 text-xs text-slate-500">Kuota {neva.quota_label || 'Tidak dibatasi'}</p>
          <p className="mt-0.5 text-xs text-slate-500">Sisa {neva.remaining_label || 'Tidak dibatasi'}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span className="truncate">Kategori terbesar: {tenant.top_category?.label || '-'}</span>
        <span className="shrink-0 font-semibold text-indigo-600">Kelola</span>
      </div>
    </button>
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
  const [storageOverlayOpen, setStorageOverlayOpen] = useState(() => Boolean(selectedTenantFromUrl()))
  const [tenantDetail, setTenantDetail] = useState(null)
  const [quotaForm, setQuotaForm] = useState({
    nevaQuotaGb: '',
    notes: ''
  })
  const [storageFilters, setStorageFilters] = useState({ tahun_ajaran: '', semester: '', bucket: '' })
  const [storageFilterDraft, setStorageFilterDraft] = useState({ tahun_ajaran: '', semester: '', bucket: '' })
  const [cleanupForm, setCleanupForm] = useState({
    provider: 'object_storage',
    bucket: '',
    tahun_ajaran: '',
    semester: '',
    older_than_days: '2'
  })
  const [cleanupPreview, setCleanupPreview] = useState(null)
  const [savingQuota, setSavingQuota] = useState(false)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [syncingObjectStorage, setSyncingObjectStorage] = useState(false)
  const [restoringTrashId, setRestoringTrashId] = useState('')
  const [deletingTrashId, setDeletingTrashId] = useState('')
  const [purgingAllTrash, setPurgingAllTrash] = useState(false)
  const [purgingTrash, setPurgingTrash] = useState(false)

  const activeSummary = tenantDetail || summary || {}
  const providerSummaries = activeSummary?.provider_summaries || {}
  const nevaSummary = providerSummaries?.neva_s3 || activeSummary?.object_storage || {}
  const activeProviderSummary = nevaSummary
  const usage = activeProviderSummary?.usage || activeSummary?.usage || {}
  const quota = activeProviderSummary?.quota || activeSummary?.quota || {}
  const allQuota = activeSummary?.quota || {}
  const nevaQuota = activeSummary?.providers?.neva_s3 || allQuota?.providers?.neva_s3 || nevaSummary?.quota || {}
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
  const combinedUsage = activeSummary?.usage || {}
  const combinedCategories = Array.isArray(combinedUsage?.by_category) ? combinedUsage.by_category : []
  const combinedPeriods = Array.isArray(combinedUsage?.by_period) ? combinedUsage.by_period : []
  const combinedLargestFiles = Array.isArray(activeSummary?.largest_files) ? activeSummary.largest_files : []
  const combinedUploaders = Array.isArray(activeSummary?.by_uploader) ? activeSummary.by_uploader : []
  const appliedFilterLabel = filterScopeLabel(storageFilters)
  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId)
  const selectedTenantName = selectedTenant?.name || tenantDetail?.tenant?.name || 'Sekolah dipilih'
  const canManageStorageScope = !isSuperAdmin || Boolean(selectedTenantId)
  const nevaUsedBytes = Number(nevaQuota?.used_bytes || 0)
  const currentNevaQuotaBytes = Number(nevaQuota?.quota_bytes || 0)
  const platformNevaRemainingBytes = Number(nevaPlatform?.remaining_after_allocated_bytes)
  const maxNevaQuotaForSelectedBytes = Number.isFinite(platformNevaRemainingBytes)
    ? platformNevaRemainingBytes + currentNevaQuotaBytes
    : null
  const activePeriod = activeSummary?.active_period || {}
  const periodOptions = useMemo(() => {
    const map = new Map()
    const addPeriod = (tahunAjaran, meta = {}) => {
      const value = storagePeriodValue(tahunAjaran)
      const match = value.match(/^(\d{4})\/\d{4}$/)
      if (!value || !match) return
      const rank = Number(match[1])
      const existing = map.get(value) || {
        value,
        tahun_ajaran: tahunAjaran,
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

    addPeriod(activePeriod?.tahun_ajaran, { isActive: true })
    periodCatalog.forEach((item) => addPeriod(item.tahun_ajaran, item))
    periods.forEach((item) => addPeriod(item.tahun_ajaran, item))

    return Array.from(map.values()).sort((a, b) => b.rank - a.rank)
  }, [
    activePeriod?.tahun_ajaran,
    periodCatalog,
    periods
  ])
  const bucketOptions = useMemo(() => {
    const map = new Map()
    const addBucket = (value, label, meta = {}) => {
      const normalized = String(value || '')
      if (!normalized) return
      const existing = map.get(normalized) || {
        value: normalized,
        label: label || bucketLabel(normalized),
        bytes: 0,
        bytes_label: '',
        files: 0
      }
      map.set(normalized, {
        ...existing,
        label: label || existing.label,
        bytes: Number(meta.bytes ?? existing.bytes ?? 0),
        bytes_label: meta.bytes_label || (existing.bytes_label || ''),
        files: Number(meta.files ?? existing.files ?? 0)
      })
    }

    ;[...nevaBucketRows, ...activeBucketRows].forEach((item) => {
      addBucket(item.bucket, item.label || bucketLabel(item.bucket), item)
    })
    if (storageFilterDraft.bucket) {
      addBucket(storageFilterDraft.bucket, bucketLabel(storageFilterDraft.bucket))
    }

    return [
      { value: '', label: 'Semua bucket' },
      ...Array.from(map.values()).sort((a, b) => (b.bytes || 0) - (a.bytes || 0))
    ]
  }, [activeBucketRows, nevaBucketRows, storageFilterDraft.bucket])
  const cleanupPeriodValue = storagePeriodValue(cleanupForm.tahun_ajaran)
  const cleanupHasProviderBucket = Boolean(cleanupForm.provider && cleanupForm.bucket)
  const cleanupReady = cleanupHasProviderBucket

  const loadAdminSummary = async (filters = storageFilters) => {
    const { data, error } = await supabase.admin.storageManager(filters)
    if (error) throw error
    setSummary(data || null)
  }

  const loadSuperSummary = async () => {
    const { data, error } = await supabase.super.storageOverview()
    if (error) throw error
    setSuperSummary(data || null)
    const tenantIds = new Set((data?.tenants || []).map((tenant) => tenant.id).filter(Boolean))
    setSelectedTenantId((current) => (current && tenantIds.has(current) ? current : ''))
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
    const neva = providerQuotas?.neva_s3 || {}
    setQuotaForm({
      nevaQuotaGb: bytesToGbInput(neva?.quota_bytes),
      notes: data?.quota?.notes || ''
    })
  }

  const openTenantStorage = (tenantId) => {
    if (!tenantId) return
    if (tenantId !== selectedTenantId) {
      setTenantDetail(null)
    }
    setSelectedTenantId(tenantId)
    setStorageOverlayOpen(true)
    setCleanupPreview(null)
  }

  const closeTenantStorage = () => {
    setStorageOverlayOpen(false)
    setSelectedTenantId('')
    setTenantDetail(null)
    setCleanupPreview(null)
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
      provider: 'object_storage'
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
    if (!isSuperAdmin) {
      pushToast('warning', 'Cleanup storage hanya dapat dilakukan Super Admin.')
      return
    }
    if (!cleanupHasProviderBucket) {
      pushToast('warning', 'Pilih bucket Neva S3 terlebih dahulu.')
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
    if (!isSuperAdmin) {
      pushToast('warning', 'Cleanup storage hanya dapat dilakukan Super Admin.')
      return
    }
    if (!cleanupHasProviderBucket) {
      pushToast('warning', 'Cleanup wajib memilih bucket Neva S3.')
      return
    }
    if (!cleanupPreview?.allowed || cleanupPreview.files <= 0) {
      pushToast('warning', 'Jalankan preview cleanup dulu')
      return
    }
    const confirmed = window.confirm(`Pindahkan ${cleanupPreview.files} file Neva S3 (${cleanupPreview.bytes_label}) ke Trash?`)
    if (!confirmed) return

    setCleanupLoading(true)
    try {
      const payload = { ...cleanupForm, backup: true }
      const api = isSuperAdmin
        ? supabase.super.superStorageCleanupExecute(selectedTenantId, payload)
        : supabase.admin.storageCleanupExecute(payload)
      const { data, error } = await api
      if (error) throw error
      pushToast('success', `${data?.files || 0} file Neva S3 dipindahkan ke Trash`)
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
        bucket: options.bucket || cleanupForm.bucket || '',
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
      const nevaQuotaBytes = toBytesFromGb(quotaForm.nevaQuotaGb)
      if (!nevaQuotaBytes) {
        pushToast('warning', 'Kuota Neva S3 wajib diisi lebih dari 0 GB.')
        return
      }
      if (nevaQuotaBytes < nevaUsedBytes) {
        pushToast('warning', `Kuota Neva S3 tidak boleh lebih kecil dari pemakaian saat ini (${nevaQuota?.used_label || formatBytesLabel(nevaUsedBytes)}).`)
        return
      }
      if (maxNevaQuotaForSelectedBytes !== null && nevaQuotaBytes > maxNevaQuotaForSelectedBytes) {
        pushToast('warning', `Kuota Neva S3 melebihi sisa platform. Maksimal untuk sekolah ini ${formatBytesLabel(maxNevaQuotaForSelectedBytes)}.`)
        return
      }
      const payload = {
        quota_bytes: nevaQuotaBytes,
        neva_s3_quota_bytes: nevaQuotaBytes,
        notes: quotaForm.notes
      }
      const { error } = await supabase.super.updateTenantStorageQuota(selectedTenantId, payload)
      if (error) throw error
      pushToast('success', 'Kuota Neva S3 sekolah disimpan')
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
    const confirmed = window.confirm('Hapus permanen file Neva S3 di Trash yang sudah kedaluwarsa lebih dari 30 hari? Data database tetap aman.')
    if (!confirmed) return

    setPurgingTrash(true)
    try {
      const { data, error } = await supabase.super.purgeExpiredStorageTrash()
      if (error) throw error
      pushToast('success', `${data?.files || 0} file Trash Neva S3 kedaluwarsa dipurge`)
      await reloadActiveStorage()
    } catch (error) {
      pushToast('error', error?.message || 'Gagal purge Trash kedaluwarsa')
    } finally {
      setPurgingTrash(false)
    }
  }

  const handleDeleteTrashFile = async (fileId, fileName) => {
    if (!isSuperAdmin || !fileId) return
    const confirmed = window.confirm(`Hapus permanen file "${fileName || 'file ini'}" dari Trash? File akan dihapus dari Neva S3 dan tidak bisa dipulihkan.`)
    if (!confirmed) return

    setDeletingTrashId(fileId)
    try {
      const { data, error } = await supabase.super.deleteStorageTrash(selectedTenantId, fileId)
      if (error) throw error
      pushToast('success', data?.message || 'File berhasil dihapus permanen dari Trash')
      await reloadActiveStorage()
    } catch (error) {
      pushToast('error', error?.message || 'Gagal menghapus file dari Trash')
    } finally {
      setDeletingTrashId('')
    }
  }

  const handlePurgeAllTrash = async () => {
    if (!isSuperAdmin || !selectedTenantId) return
    const trashCount = activeSummary?.trash?.files || 0
    const confirmed = window.confirm(
      `Hapus permanen SEMUA ${trashCount} file di Trash sekolah ini? Semua file akan dihapus dari Neva S3 dan tidak bisa dipulihkan.`
    )
    if (!confirmed) return

    setPurgingAllTrash(true)
    try {
      const { data, error } = await supabase.super.purgeAllTenantTrash(selectedTenantId)
      if (error) throw error
      pushToast('success', data?.message || `${data?.files || 0} file Trash dihapus permanen`)
      await reloadActiveStorage()
    } catch (error) {
      pushToast('error', error?.message || 'Gagal menghapus semua file Trash')
    } finally {
      setPurgingAllTrash(false)
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
        bucket: nextFilters.bucket || prev.bucket
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
    const next = { tahun_ajaran: '', semester: '', bucket: '' }
    setStorageFilterDraft(next)
    loadStorageWithFilters(next)
  }

  const cleanupSection = (
    <section className="rounded-lg border border-rose-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <h2 className="text-sm font-bold text-slate-900">Cleanup Aman ke Trash</h2>
          <p className="mt-1 text-xs text-slate-500">
            Cleanup hanya untuk file storage Neva S3 pada bucket yang dipilih dan sudah berumur minimal 2 hari. Data tugas, quiz, nilai, siswa, dan guru tetap aman.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">Trash 30 hari</span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-semibold text-amber-800">Minimal 2 hari</span>
          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 font-semibold text-indigo-700">Neva S3 only</span>
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
                disabled
                className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700"
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
              Periode
              <select
                value={cleanupPeriodValue}
                onChange={(event) => updateCleanupForm(parseStoragePeriodValue(event.target.value))}
                className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">Semua periode</option>
                {periodOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.tahun_ajaran}{item.isActive ? ' (Aktif)' : ''}{item.bytes_label ? ` (${item.bytes_label})` : ''}
                  </option>
                ))}
                {periodOptions.length === 0 && (
                  <option value="" disabled>Belum ada periode tercatat</option>
                )}
              </select>
              <span className="mt-1 block text-[11px] font-normal text-slate-500">
                Opsional. Kosongkan untuk cleanup berdasarkan umur file saja.
              </span>
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
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Pengaman aktif</h3>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            {[
              'Tidak bisa untuk file di bawah 2 hari',
              'Periode opsional, bisa memilih satu tahun ajaran penuh',
              'Target berdasarkan bucket, bukan kategori manual',
              'Bucket aman: tugas, media quiz, dan sertifikat',
              'Hanya berlaku untuk Neva Cloud S3',
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
          Pilih bucket Neva S3 terlebih dahulu supaya cleanup hanya menyasar lokasi storage yang benar.
        </div>
      )}
      {cleanupPreview && (
        <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${cleanupPreview.allowed ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold">{cleanupPreview.message}</p>
              <p className="mt-1 text-xs opacity-80">
                Kandidat: {numberFormatter.format(cleanupPreview.files || 0)} file ({cleanupPreview.bytes_label || '0 B'}). Bucket: {cleanupPreview.bucket_label || bucketLabel(cleanupForm.bucket)}. Umur minimal: {cleanupPreview.minimum_age_days || cleanupForm.older_than_days} hari.
              </p>
            </div>
          </div>
          {Array.isArray(cleanupPreview.candidates) && cleanupPreview.candidates.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-white/70 bg-white text-slate-700">
              <div className="min-w-[620px]">
              <div className="grid grid-cols-[minmax(180px,1fr)_110px_90px_120px] gap-3 border-b border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <span>File</span>
                <span>Ukuran</span>
                <span>Umur</span>
                <span>Jenis</span>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {cleanupPreview.candidates.map((file) => (
                  <div key={file.id || `${file.bucket}-${file.path}`} className="grid grid-cols-[minmax(180px,1fr)_110px_90px_120px] gap-3 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{file.file_name || file.path || '-'}</p>
                      <p className="truncate text-[11px] text-slate-500">{file.bucket_label || bucketLabel(file.bucket)} · {file.path || '-'}</p>
                    </div>
                    <span className="font-semibold text-slate-800">{file.size_label || formatBytesLabel(file.size_bytes)}</span>
                    <span>{file.age_days !== null && file.age_days !== undefined ? `${file.age_days} hari` : '-'}</span>
                    <span className="truncate">{file.extension ? `.${file.extension}` : file.category_label || '-'}</span>
                  </div>
                ))}
              </div>
              {(cleanupPreview.files || 0) > cleanupPreview.candidates.length && (
                <p className="bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Menampilkan {cleanupPreview.candidates.length} dari {numberFormatter.format(cleanupPreview.files || 0)} kandidat. Semua kandidat tetap ikut diproses saat cleanup dijalankan.
                </p>
              )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )

  const quotaSection = (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold text-slate-900">Pembagian Kuota Neva S3 Sekolah</h2>
      <p className="mt-1 text-xs text-slate-500">
        {selectedTenant?.name || tenantDetail?.tenant?.name || 'Sekolah dipilih'} mendapat jatah Neva S3 dari kapasitas platform. Kuota tidak bisa lebih kecil dari pemakaian sekolah saat ini.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <label className="block text-xs font-semibold text-slate-600">
          Kuota Neva S3 (GB)
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={quotaForm.nevaQuotaGb}
            onChange={(e) => setQuotaForm((prev) => ({ ...prev, nevaQuotaGb: e.target.value }))}
            placeholder="contoh: 40"
            className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-800">
          <p className="font-bold uppercase tracking-wide">Sisa platform bisa dibagi</p>
          <p className="mt-2 text-lg font-semibold text-indigo-950">{nevaPlatform?.remaining_after_allocated_label || 'Belum diset'}</p>
          <p className="mt-1">Maksimal untuk sekolah ini: <span className="font-semibold">{maxNevaQuotaForSelectedBytes !== null ? formatBytesLabel(maxNevaQuotaForSelectedBytes) : 'Set APP_OBJECT_STORAGE_CAPACITY_GB'}</span></p>
        </div>
      </div>
      <div className="mt-3 grid gap-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-bold uppercase tracking-wide text-slate-500">Indikator Neva S3</p>
          <div className="mt-2 space-y-1">
            <p>Pemakaian sekolah: <span className="font-semibold text-slate-900">{nevaQuota?.used_label || formatBytesLabel(nevaUsedBytes)}</span></p>
            <p>Kuota saat ini: <span className="font-semibold text-slate-900">{nevaQuota?.quota_label || 'Belum diset'}</span></p>
            <p>Sisa platform bisa dibagi: <span className="font-semibold text-slate-900">{nevaPlatform?.remaining_after_allocated_label || 'Belum diset'}</span></p>
            <p>Maksimal untuk sekolah ini: <span className="font-semibold text-slate-900">{maxNevaQuotaForSelectedBytes !== null ? formatBytesLabel(maxNevaQuotaForSelectedBytes) : 'Set APP_OBJECT_STORAGE_CAPACITY_GB'}</span></p>
          </div>
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
        Kuota tidak bisa disimpan jika lebih kecil dari pemakaian saat ini atau lebih besar dari sisa kapasitas platform Neva S3. Storage Manager tidak memasang batas ukuran per-file.
      </div>
      <label className="mt-3 block text-xs font-semibold text-slate-600">
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
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        <Save size={16} />
        {savingQuota ? 'Menyimpan...' : 'Simpan Kuota'}
      </button>
    </section>
  )

  const storageFilterSection = (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Filter Storage</h2>
          <p className="mt-1 text-xs text-slate-500">
            {isSuperAdmin
              ? 'Filter ini dipakai untuk analitik, file terbesar, uploader, rekomendasi, dan preview cleanup.'
              : `Filter ini hanya membaca metadata storage milik sekolah ini. Scope aktif: ${appliedFilterLabel}.`}
          </p>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-2 lg:max-w-3xl lg:grid-cols-[1fr_180px_auto_auto]">
          <select
            value={storagePeriodValue(storageFilterDraft.tahun_ajaran)}
            onChange={(event) => setStorageFilterDraft((prev) => ({
              ...prev,
              ...parseStoragePeriodValue(event.target.value)
            }))}
            className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Semua periode</option>
            {periodOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.tahun_ajaran}{item.isActive ? ' (Aktif)' : ''}{item.bytes_label ? ` · ${item.bytes_label}` : ''}
              </option>
            ))}
            {periodOptions.length === 0 && <option value="" disabled>Belum ada periode tercatat</option>}
          </select>
          <select
            value={storageFilterDraft.bucket}
            onChange={(event) => setStorageFilterDraft((prev) => ({ ...prev, bucket: event.target.value }))}
            className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            {bucketOptions.map((item) => (
              <option key={item.value || 'all'} value={item.value}>
                {item.label}{item.bytes_label ? ` · ${item.bytes_label}` : ''}
              </option>
            ))}
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
  )

  const tenantStorageOverlay = storageOverlayOpen && selectedTenantId ? (
    <div className="fixed inset-0 z-50 bg-slate-950/50 p-3 backdrop-blur-sm sm:p-6">
      <section className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-lg bg-slate-50 shadow-2xl">
        <div className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">Kelola Storage Sekolah</p>
              <h2 className="truncate text-xl font-bold text-slate-950">{selectedTenantName}</h2>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-600">{tenantDetail?.tenant?.slug || selectedTenant?.slug || selectedTenantId}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-600">Status: {tenantDetail?.tenant?.status || selectedTenant?.status || '-'}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => handleSyncObjectStorage(selectedTenantId, { bucket: '' })}
                disabled={syncingObjectStorage || !nevaEnabled}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-60"
              >
                <RefreshCw size={16} className={syncingObjectStorage ? 'animate-spin' : ''} />
                {syncingObjectStorage ? 'Membaca S3...' : 'Scan Neva S3'}
              </button>
              <button
                type="button"
                onClick={closeTenantStorage}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <X size={16} />
                Tutup
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {!tenantDetail ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              Memuat detail storage sekolah...
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatTile icon={Cloud} label="S3 Terpakai" value={nevaQuota?.used_label || '0 B'} hint={`Total sekolah · ${providerPercentLabel(nevaQuota)}`} />
                <StatTile icon={ShieldCheck} label="Kuota S3" value={nevaQuota?.quota_label || 'Tidak dibatasi'} />
                <StatTile icon={Archive} label="Sisa S3" value={nevaQuota?.remaining_label || 'Tidak dibatasi'} />
                <StatTile icon={Trash2} label="Trash" value={activeSummary?.trash?.bytes_label || '0 B'} hint={`${numberFormatter.format(activeSummary?.trash?.files || 0)} file`} />
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                {quotaSection}
                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-sm font-bold text-slate-900">Status Neva S3</h2>
                  <p className="mt-1 text-xs text-slate-500">Provider cepat untuk upload harian tugas, media quiz, dan sertifikat.</p>
                  <div className="mt-3 space-y-2">
                    {[
                      ['Provider S3', nevaEnabled, nevaPlatform?.label || 'Neva Cloud S3'],
                      ['Endpoint', Boolean(nevaPlatform?.endpoint), nevaPlatform?.endpoint || 'Endpoint diambil dari ENV server'],
                      ['Direct upload browser', nevaDirectEnabled, nevaDirectEnabled ? 'Aktif' : 'Fallback backend tetap aman'],
                      ['Verifikasi object', Boolean(nevaPlatform?.verify_objects), nevaPlatform?.verify_objects ? 'Aktif' : 'Opsional belum aktif']
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
                </section>
              </div>

              {storageFilterSection}

              <div className="grid gap-4">
                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-sm font-bold text-slate-900">Bucket Neva S3</h2>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {nevaBucketRows.map((bucket) => (
                      <div key={bucket.bucket} className="rounded-lg border border-slate-100 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{bucket.label || NEVA_BUCKET_LABELS[bucket.bucket] || bucket.bucket}</p>
                            <p className="truncate text-xs text-slate-500">{bucket.physical_bucket || bucket.bucket}</p>
                          </div>
                          <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">{bucket.bytes_label || '0 B'}</span>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">Sisa sekolah: {bucket.remaining_after_provider_label || 'Tidak dibatasi'}</p>
                      </div>
                    ))}
                    {nevaBucketRows.length === 0 && <p className="text-sm text-slate-500">Belum ada bucket Neva tercatat.</p>}
                  </div>
                </section>
              </div>

              {cleanupSection}

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <BarChart3 size={18} className="text-indigo-600" />
                    <h2 className="text-sm font-bold text-slate-900">Analitik Gabungan</h2>
                  </div>
                  <div className="grid gap-5 lg:grid-cols-2">
                    <div className="space-y-3">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Kategori terbesar</h3>
                      {combinedCategories.map((item) => (
                        <ProgressLine key={item.category} label={item.label} value={item.bytes_label} percent={combinedUsage.total_bytes ? (item.bytes / combinedUsage.total_bytes) * 100 : 0} />
                      ))}
                      {combinedCategories.length === 0 && <p className="text-sm text-slate-500">Belum ada metadata storage baru.</p>}
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Periode terbesar</h3>
                      {combinedPeriods.slice(0, 6).map((item) => (
                        <ProgressLine key={`${item.tahun_ajaran}-${item.semester}`} label={`${item.tahun_ajaran || '-'} ${item.semester || ''}`} value={item.bytes_label} percent={combinedUsage.total_bytes ? (item.bytes / combinedUsage.total_bytes) * 100 : 0} />
                      ))}
                      {combinedPeriods.length === 0 && <p className="text-sm text-slate-500">Belum ada data periode.</p>}
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
                      <div key={`${item.type}-${index}`} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700">{item.message}</div>
                    ))}
                    {recommendations.length === 0 && <p className="text-sm text-slate-600">Belum ada rekomendasi kritikal.</p>}
                  </div>
                </section>
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-sm font-bold text-slate-900">File Terbesar</h2>
                  <div className="mt-3 space-y-2">
                    {combinedLargestFiles.slice(0, 8).map((file) => (
                      <div key={file.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{file.file_name}</p>
                          <p className="text-xs text-slate-500">{file.category_label} · {file.provider}</p>
                        </div>
                        <span className="shrink-0 text-sm font-bold text-slate-700">{file.size_label}</span>
                      </div>
                    ))}
                    {combinedLargestFiles.length === 0 && <p className="text-sm text-slate-500">Belum ada file tercatat.</p>}
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-sm font-bold text-slate-900">Uploader Terbesar</h2>
                  <div className="mt-3 space-y-2">
                    {combinedUploaders.slice(0, 8).map((user) => (
                      <div key={user.user_id || user.nama} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{user.nama}</p>
                          <p className="text-xs text-slate-500">{user.role || '-'} · {numberFormatter.format(user.files || 0)} file</p>
                        </div>
                        <span className="shrink-0 text-sm font-bold text-slate-700">{user.bytes_label}</span>
                      </div>
                    ))}
                    {combinedUploaders.length === 0 && <p className="text-sm text-slate-500">Belum ada uploader tercatat.</p>}
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-bold text-slate-900">Trash Terbaru</h2>
                    {trashFiles.length > 0 && (
                      <button
                        type="button"
                        onClick={handlePurgeAllTrash}
                        disabled={purgingAllTrash || deletingTrashId !== '' || restoringTrashId !== ''}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                      >
                        {purgingAllTrash ? 'Menghapus...' : 'Hapus Semua Trash'}
                      </button>
                    )}
                  </div>
                  <div className="mt-3 space-y-2">
                    {trashFiles.slice(0, 8).map((file) => (
                      <div key={file.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{file.file_name}</p>
                          <p className="text-xs text-slate-500">{file.category_label} · {file.size_label}</p>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleRestoreTrashFile(file.id)}
                            disabled={restoringTrashId === file.id || deletingTrashId === file.id}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                          >
                            {restoringTrashId === file.id ? '...' : 'Restore'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTrashFile(file.id, file.file_name)}
                            disabled={deletingTrashId === file.id || restoringTrashId === file.id}
                            className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                          >
                            {deletingTrashId === file.id ? '...' : 'Hapus'}
                          </button>
                        </div>
                      </div>
                    ))}
                    {trashFiles.length === 0 && <p className="text-sm text-slate-500">Trash masih kosong.</p>}
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  ) : null

  const adminMonitoringView = !isSuperAdmin ? (
    <section className="space-y-6">
      <div className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-slate-950">Monitoring Storage Sekolah</h2>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                Read-only
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Periode aktif: <span className="font-semibold text-slate-900">{activePeriod?.tahun_ajaran || '-'} {activePeriod?.semester || ''}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={Cloud} label="S3 Terpakai" value={nevaQuota?.used_label || nevaSummary?.usage?.total_label || '0 B'} hint={`Total sekolah · ${providerPercentLabel(nevaQuota)}`} />
        <StatTile icon={ShieldCheck} label="Kuota S3" value={nevaQuota?.quota_label || 'Tidak dibatasi'} />
        <StatTile icon={Archive} label="Sisa S3" value={nevaQuota?.remaining_label || 'Tidak dibatasi'} />
        <StatTile icon={Trash2} label="Trash" value={activeSummary?.trash?.bytes_label || '0 B'} hint={`${numberFormatter.format(activeSummary?.trash?.files || 0)} file`} />
      </div>

      <section className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-card">
        <div className="grid gap-4">
          <ProgressLine
            label="Pemakaian Neva S3 sekolah"
            value={`${nevaQuota?.used_label || '0 B'} dari ${nevaQuota?.quota_label || 'kuota tidak dibatasi'}`}
            percent={nevaQuota?.percent || 0}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Angka di atas adalah total storage milik sekolah ini. Filter di bawah hanya mengubah analitik, bucket, file terbesar, dan uploader untuk scope sekolah yang sama.
        </p>
      </section>

      {storageFilterSection}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-slate-900">Bucket Storage Sekolah</h2>
            <p className="text-xs text-slate-500">
              Pantau pemakaian bucket Neva S3 milik sekolah ini saja. Total S3 sekolah: <span className="font-semibold text-slate-700">{nevaQuota?.used_label || nevaSummary?.usage?.total_label || '0 B'}</span>, sisa kuota S3: <span className="font-semibold text-slate-700">{nevaQuota?.remaining_label || 'Tidak dibatasi'}</span>.
            </p>
          </div>
          <div className="mt-4 grid gap-4">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Neva Cloud S3</h3>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${providerBadgeClass(nevaEnabled)}`}>
                  {nevaEnabled ? 'Aktif' : 'Belum aktif'}
                </span>
              </div>
              <div className="space-y-3">
                {nevaBucketRows.map((bucket) => (
                  <div key={bucket.bucket} className="rounded-xl border border-slate-100 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{bucket.label || NEVA_BUCKET_LABELS[bucket.bucket] || bucket.bucket}</p>
                        <p className="truncate text-xs text-slate-500">{bucket.physical_bucket || bucket.bucket}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">{bucket.bytes_label || '0 B'}</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Sisa sekolah: {bucket.remaining_after_provider_label || 'Tidak dibatasi'}</p>
                  </div>
                ))}
                {nevaBucketRows.length === 0 && <p className="text-sm text-slate-500">Belum ada bucket Neva tercatat.</p>}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold text-slate-900">Status Provider</h2>
          <p className="mt-1 text-xs text-slate-500">Ringkasan jalur penyimpanan yang sedang dipakai sekolah.</p>
          <div className="mt-4 space-y-3">
            {[
              ['Neva Cloud S3', nevaEnabled, nevaPlatform?.endpoint || 'Endpoint diambil dari server'],
              ['Direct upload', nevaDirectEnabled, nevaDirectEnabled ? 'Aktif untuk upload cepat' : 'Fallback backend tetap aman'],
              ['Verifikasi object', Boolean(nevaPlatform?.verify_objects), nevaPlatform?.verify_objects ? 'Aktif' : 'Opsional belum aktif']
            ].map(([label, ok, detail]) => (
              <div key={label} className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
                {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 text-slate-400" />}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{label}</p>
                  <p className="truncate text-xs text-slate-500">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 size={18} className="text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-900">Analitik Storage</h2>
          </div>
          <p className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
            Hasil analitik di bawah mengikuti filter sekolah ini: <span className="font-semibold">{appliedFilterLabel}</span>.
          </p>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Kategori terbesar</h3>
              {combinedCategories.map((item) => (
                <ProgressLine key={item.category} label={item.label} value={item.bytes_label} percent={combinedUsage.total_bytes ? (item.bytes / combinedUsage.total_bytes) * 100 : 0} />
              ))}
              {combinedCategories.length === 0 && <p className="text-sm text-slate-500">Belum ada metadata storage baru.</p>}
            </div>
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Periode terbesar</h3>
              {combinedPeriods.slice(0, 6).map((item) => (
                <ProgressLine key={`${item.tahun_ajaran}-${item.semester}`} label={`${item.tahun_ajaran || '-'} ${item.semester || ''}`} value={item.bytes_label} percent={combinedUsage.total_bytes ? (item.bytes / combinedUsage.total_bytes) * 100 : 0} />
              ))}
              {combinedPeriods.length === 0 && <p className="text-sm text-slate-500">Belum ada data periode.</p>}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-card">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-700" />
            <h2 className="text-sm font-bold text-slate-900">Rekomendasi</h2>
          </div>
          <div className="mt-3 space-y-2">
            {recommendations.map((item, index) => (
              <div key={`${item.type}-${index}`} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700">{item.message}</div>
            ))}
            {recommendations.length === 0 && <p className="text-sm text-slate-600">Belum ada rekomendasi kritikal.</p>}
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold text-slate-900">File Terbesar</h2>
          <div className="mt-3 space-y-2">
            {combinedLargestFiles.slice(0, 8).map((file) => (
              <div key={file.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{file.file_name}</p>
                  <p className="text-xs text-slate-500">{file.category_label} · {file.provider} · {formatDateTime(file.uploaded_at)}</p>
                </div>
                <span className="shrink-0 text-sm font-bold text-slate-700">{file.size_label}</span>
              </div>
            ))}
            {combinedLargestFiles.length === 0 && <p className="text-sm text-slate-500">Belum ada file tercatat.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold text-slate-900">Uploader Terbesar</h2>
          <div className="mt-3 space-y-2">
            {combinedUploaders.slice(0, 8).map((user) => (
              <div key={user.user_id || user.nama} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{user.nama}</p>
                  <p className="text-xs text-slate-500">{user.role || '-'} · {numberFormatter.format(user.files || 0)} file</p>
                </div>
                <span className="shrink-0 text-sm font-bold text-slate-700">{user.bytes_label}</span>
              </div>
            ))}
            {combinedUploaders.length === 0 && <p className="text-sm text-slate-500">Belum ada uploader tercatat.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900">Trash Terbaru</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {numberFormatter.format(activeSummary?.trash?.files || 0)} file
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">Hanya monitoring. Pemulihan atau purge dilakukan Super Admin.</p>
          <div className="mt-3 space-y-2">
            {trashFiles.slice(0, 8).map((file) => (
              <div key={file.id} className="rounded-xl border border-slate-100 px-3 py-2">
                <p className="truncate text-sm font-semibold text-slate-900">{file.file_name}</p>
                <p className="text-xs text-slate-500">{file.category_label} · {file.size_label} · kedaluwarsa {formatDateTime(file.trash_expires_at)}</p>
              </div>
            ))}
            {trashFiles.length === 0 && <p className="text-sm text-slate-500">Trash masih kosong.</p>}
          </div>
        </section>
      </div>
    </section>
  ) : null

  const superAdminCombinedView = isSuperAdmin ? (
    <>
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Platform Storage</h2>
            <p className="mt-1 text-xs text-slate-500">
              Neva Cloud S3 menjadi storage utama. Klik kartu sekolah untuk pembagian kuota, monitoring bucket, scan inventaris, dan cleanup aman.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleSyncObjectStorage('', { bucket: '' })}
            disabled={syncingObjectStorage || !nevaEnabled}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50 disabled:opacity-60"
          >
            <RefreshCw size={16} className={syncingObjectStorage ? 'animate-spin' : ''} />
            {syncingObjectStorage ? 'Membaca S3...' : 'Scan Platform Neva'}
          </button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatTile icon={Cloud} label="Total Neva S3" value={nevaPlatform?.capacity_label || 'Belum diset'} hint={nevaPlatform?.endpoint || 'Neva Cloud S3'} />
          <StatTile icon={ShieldCheck} label="S3 Dibagikan" value={nevaPlatform?.allocated_quota_label || '0 B'} hint="Total kuota sekolah" />
          <StatTile icon={Database} label="Sisa S3 Bisa Dibagi" value={nevaPlatform?.remaining_after_allocated_label || 'Belum diset'} hint="Belum dialokasikan" />
          <StatTile icon={Archive} label="Terbaca di S3" value={nevaPlatform?.tracked_label || nevaPlatform?.total_label || '0 B'} hint={`${numberFormatter.format(nevaPlatform?.tracked_files || nevaPlatform?.total_files || 0)} file`} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Sekolah</h2>
            <p className="mt-1 text-xs text-slate-500">Tiga kartu per baris di desktop. Sekolah baru otomatis turun ke baris berikutnya.</p>
          </div>
          <span className="text-xs font-semibold text-slate-500">{numberFormatter.format(tenants.length)} sekolah</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {tenants.map((tenant) => (
            <TenantStorageCard
              key={tenant.id}
              tenant={tenant}
              selected={tenant.id === selectedTenantId}
              onClick={() => openTenantStorage(tenant.id)}
            />
          ))}
          {tenants.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
              Belum ada sekolah yang bisa dikelola.
            </div>
          )}
        </div>
      </section>

      {tenantStorageOverlay}
    </>
  ) : null

  if (!superAdminChecked) {
    return <div className="page-wrapper text-sm text-slate-500">Memuat akses storage manager...</div>
  }

  return (
    <div className="page-wrapper">
      <div className="w-full space-y-6">
        <section className="page-title-card">
          <div className="page-title-layout">
            <div className="page-title-main">
              <div className="page-title-icon bg-indigo-100 text-indigo-700">
                <HardDrive size={26} />
              </div>
              <div>
                <p className="page-title-kicker">Storage Manager</p>
                <h1 className="page-title-heading">Storage Neva Cloud S3</h1>
                <p className="page-title-description">
                  {isSuperAdmin
                    ? 'Kelola kuota, monitoring bucket, scan inventaris, cleanup aman, dan Trash Neva S3 semua sekolah dari satu halaman.'
                    : 'Pantau pemakaian Neva Cloud S3 sekolah secara ringkas, responsif, dan read-only.'}
                </p>
              </div>
            </div>
            <div className="page-title-actions">
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={handlePurgeExpiredTrash}
                  disabled={purgingTrash}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:opacity-60"
                >
                  <Trash2 size={16} />
                  {purgingTrash ? 'Memproses...' : 'Purge Trash S3'}
                </button>
              )}
              <button
                type="button"
                onClick={refresh}
                disabled={loading}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>
        </section>

        {false && !isSuperAdmin && (
          <div className="flex gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setActiveTab('storage')}
              className={`inline-flex min-w-max items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold ${activeTab === 'storage' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <HardDrive size={16} />
              Legacy Storage
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
        )}

        {storageError && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-card">
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

        {superAdminCombinedView}
        {adminMonitoringView}

        {false && activeTab === 'neva' && !isSuperAdmin && (
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
                  Setiap bucket memakai kuota Neva S3 sekolah. Sisa kuota dihitung dari jatah Neva sekolah.
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

        {false && activeTab === 'storage' && !isSuperAdmin && (
          <>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={HardDrive} label="Legacy Terpakai" value={usage.total_label || quota.used_label} hint={`${numberFormatter.format(usage.total_files || 0)} file`} />
          <StatTile icon={Database} label="Kuota Legacy" value={quota.quota_label} hint={quota.percent !== null && quota.percent !== undefined ? `${quota.percent}% terpakai` : 'Belum dibatasi'} />
          <StatTile icon={Archive} label="Sisa Legacy" value={quota.remaining_label} />
          <StatTile icon={Trash2} label="Trash" value={activeSummary?.trash?.bytes_label || '0 B'} hint={`${numberFormatter.format(activeSummary?.trash?.files || 0)} file`} />
        </div>

        {quota.percent !== null && quota.percent !== undefined && (
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <ProgressLine label="Pemakaian kuota legacy sekolah" value={`${quota.percent}%`} percent={quota.percent} />
          </section>
        )}

        {activeBucketRows.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-bold text-slate-900">Bucket Legacy Sekolah</h2>
              <p className="text-xs text-slate-500">
                Bucket ini hanya arsip legacy. Cleanup aktif memakai Neva Cloud S3.
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

        {storageFilterSection}

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

        {false && !isSuperAdmin && canManageStorageScope && cleanupSection}
      </div>
    </div>
  )
}

export default StorageManager
