import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  BarChart3,
  CheckCircle2,
  Cloud,
  Database,
  ExternalLink,
  FileText,
  FolderOpen,
  HardDrive,
  Link2,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Unplug,
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

const SEMESTERS = [
  { value: '', label: 'Semua semester' },
  { value: 'Ganjil', label: 'Ganjil' },
  { value: 'Genap', label: 'Genap' }
]

const DRIVE_FILE_BUCKET_OPTIONS = [
  { value: 'all', label: 'Semua file' },
  { value: 'assignments', label: 'Tugas' },
  { value: 'quiz-media', label: 'Quiz' }
]

const DRIVE_STATUS_DEFAULT = {
  ready: false,
  configured: false,
  provider_configured: true,
  status: 'not_connected',
  status_label: 'Belum tersambung',
  quota: { used_label: '0 B', limit_label: 'Tidak terbatas', percent: null },
  today: { uploaded_label: '0 B', files: 0 },
  app_storage: { uploaded_label: '0 B', files: 0 },
  app_storage_all: { uploaded_label: '0 B', files: 0 }
}

const numberFormatter = new Intl.NumberFormat('id-ID')
const toBytesFromGb = (value) => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.round(num * 1024 * 1024 * 1024) : null
}
const toBytesFromMb = (value) => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.round(num * 1024 * 1024) : null
}
const bytesToGbInput = (bytes) => bytes ? String(Math.round((Number(bytes) / 1024 / 1024 / 1024) * 100) / 100) : ''
const bytesToMbInput = (bytes) => bytes ? String(Math.round((Number(bytes) / 1024 / 1024) * 100) / 100) : ''
const activeTabFromUrl = () => {
  if (typeof window === 'undefined') return 'storage'
  return new URLSearchParams(window.location.search).get('tab') === 'drive' ? 'drive' : 'storage'
}
const normalizeDriveStatus = (data) => data || DRIVE_STATUS_DEFAULT
const labelOrZero = (value) => value || '0 B'
const driveBadgeClass = (ready, status) => (
  ready
    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : status === 'needs_attention'
      ? 'bg-amber-100 text-amber-800 border-amber-200'
      : 'bg-slate-100 text-slate-600 border-slate-200'
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
  const [activeTab, setActiveTab] = useState(activeTabFromUrl)
  const [summary, setSummary] = useState(null)
  const [superSummary, setSuperSummary] = useState(null)
  const [selectedTenantId, setSelectedTenantId] = useState('')
  const [tenantDetail, setTenantDetail] = useState(null)
  const [quotaForm, setQuotaForm] = useState({ quotaGb: '', maxUploadMb: '', notes: '' })
  const [cleanupForm, setCleanupForm] = useState({
    tahun_ajaran: '',
    semester: '',
    category: '',
    older_than_days: '365',
    largest_percent: ''
  })
  const [cleanupPreview, setCleanupPreview] = useState(null)
  const [savingQuota, setSavingQuota] = useState(false)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [restoringTrashId, setRestoringTrashId] = useState('')
  const [purgingTrash, setPurgingTrash] = useState(false)
  const [driveStatus, setDriveStatus] = useState(DRIVE_STATUS_DEFAULT)
  const [driveFiles, setDriveFiles] = useState([])
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveFilesLoading, setDriveFilesLoading] = useState(false)
  const [driveConnecting, setDriveConnecting] = useState(false)
  const [driveSyncing, setDriveSyncing] = useState(false)
  const [driveDisconnecting, setDriveDisconnecting] = useState(false)
  const [driveFileBucket, setDriveFileBucket] = useState('all')
  const [driveFileSearch, setDriveFileSearch] = useState('')
  const [drivePeriod, setDrivePeriod] = useState({ tahun_ajaran: '', semester: '' })

  const activeSummary = tenantDetail || summary || {}
  const usage = activeSummary?.usage || {}
  const quota = activeSummary?.quota || {}
  const categories = Array.isArray(usage?.by_category) ? usage.by_category : []
  const periods = Array.isArray(usage?.by_period) ? usage.by_period : []
  const largestFiles = Array.isArray(activeSummary?.largest_files) ? activeSummary.largest_files : []
  const uploaders = Array.isArray(activeSummary?.by_uploader) ? activeSummary.by_uploader : []
  const recommendations = Array.isArray(activeSummary?.recommendations) ? activeSummary.recommendations : []
  const trashFiles = Array.isArray(activeSummary?.trash_files) ? activeSummary.trash_files : []
  const driveReady = Boolean(driveStatus?.ready)
  const driveProviderConfigured = driveStatus?.provider_configured !== false
  const driveQuotaPercent = Number(driveStatus?.quota?.percent)
  const driveQuotaPercentLabel = Number.isFinite(driveQuotaPercent) ? `${driveQuotaPercent.toLocaleString('id-ID')}%` : 'Tidak terbatas'
  const driveQuotaBarWidth = Number.isFinite(driveQuotaPercent) ? Math.max(0, Math.min(100, driveQuotaPercent)) : 0
  const driveFilteredStorage = driveStatus?.app_storage || DRIVE_STATUS_DEFAULT.app_storage
  const driveAllStorage = driveStatus?.app_storage_all || driveStatus?.app_storage || DRIVE_STATUS_DEFAULT.app_storage
  const driveClassUsageRows = Array.isArray(driveStatus?.usage_by_class) ? driveStatus.usage_by_class : []
  const driveSemesterUsageRows = Array.isArray(driveStatus?.usage_by_semester) ? driveStatus.usage_by_semester : []
  const driveFileQuery = driveFileSearch.trim().toLowerCase()
  const driveVisibleFiles = driveFileQuery
    ? driveFiles.filter((file) => [
      file.drive_file_name,
      file.module_label,
      file.bucket,
      file.kelas,
      file.angkatan,
      file.tahun_ajaran,
      file.semester,
      file.extension,
      file.source_path
    ].some((value) => String(value || '').toLowerCase().includes(driveFileQuery)))
    : driveFiles

  const tenants = useMemo(() => (
    Array.isArray(superSummary?.tenants) ? superSummary.tenants : []
  ), [superSummary])
  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId)

  const loadAdminSummary = async () => {
    const { data, error } = await supabase.admin.storageManager()
    if (error) throw error
    setSummary(data || null)
  }

  const loadSuperSummary = async () => {
    const { data, error } = await supabase.super.storageOverview()
    if (error) throw error
    setSuperSummary(data || null)
    const firstTenant = data?.tenants?.[0]?.id
    setSelectedTenantId((current) => current || firstTenant || '')
  }

  const loadDriveStatus = async ({ sync = false } = {}) => {
    if (isSuperAdmin) return
    setDriveLoading(true)
    try {
      const params = {
        tahun_ajaran: drivePeriod.tahun_ajaran,
        semester: drivePeriod.semester
      }
      const api = sync ? supabase.admin.syncGoogleDrive(params) : supabase.admin.googleDrive(params)
      const { data, error } = await api
      if (error) throw error
      setDriveStatus(normalizeDriveStatus(data))
    } catch (error) {
      setDriveStatus(DRIVE_STATUS_DEFAULT)
      pushToast('error', error?.message || 'Gagal memuat status Google Drive')
    } finally {
      setDriveLoading(false)
    }
  }

  const loadDriveFiles = async () => {
    if (isSuperAdmin) return
    setDriveFilesLoading(true)
    try {
      const params = {
        tahun_ajaran: drivePeriod.tahun_ajaran,
        semester: drivePeriod.semester,
        limit: 40
      }
      if (driveFileBucket !== 'all') params.bucket = driveFileBucket
      const { data, error } = await supabase.admin.googleDriveFiles(params)
      if (error) throw error
      setDriveFiles(Array.isArray(data?.rows) ? data.rows : [])
    } catch (error) {
      setDriveFiles([])
      pushToast('error', error?.message || 'Gagal memuat file Google Drive')
    } finally {
      setDriveFilesLoading(false)
    }
  }

  const fetchTenantDetail = async (tenantId) => {
    const { data, error } = await supabase.super.tenantStorage(tenantId)
    if (error) throw error
    return data || null
  }

  const applyTenantDetail = (data) => {
    setTenantDetail(data || null)
    setQuotaForm({
      quotaGb: bytesToGbInput(data?.quota?.quota_bytes),
      maxUploadMb: bytesToMbInput(data?.quota?.max_upload_bytes),
      notes: data?.quota?.notes || ''
    })
  }

  const reloadActiveStorage = async () => {
    if (isSuperAdmin) {
      await loadSuperSummary()
      if (selectedTenantId) {
        const data = await fetchTenantDetail(selectedTenantId)
        applyTenantDetail(data)
      }
      return
    }

    await loadAdminSummary()
  }

  const refresh = async () => {
    setLoading(true)
    try {
      if (activeTab === 'drive' && !isSuperAdmin) {
        await Promise.all([loadDriveStatus(), loadDriveFiles()])
      } else if (isSuperAdmin) {
        await loadSuperSummary()
      } else {
        await loadAdminSummary()
      }
    } catch (error) {
      pushToast('error', error?.message || 'Gagal memuat storage manager')
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
    const driveState = String(url.searchParams.get('drive') || '').trim()
    const driveError = String(url.searchParams.get('drive_error') || '').trim()
    if (!driveState && !driveError) return

    if (driveState === 'connected') pushToast('success', 'Google Drive sekolah berhasil tersambung.')
    if (driveState === 'failed') pushToast('error', driveError || 'Gagal menyambungkan Google Drive sekolah.')
    url.searchParams.delete('drive')
    url.searchParams.delete('drive_error')
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
  }, [pushToast])

  useEffect(() => {
    if (isSuperAdmin && activeTab === 'drive') {
      setActiveTab('storage')
    }
  }, [activeTab, isSuperAdmin])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (activeTab === 'drive') url.searchParams.set('tab', 'drive')
    else url.searchParams.delete('tab')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }, [activeTab])

  useEffect(() => {
    const activePeriod = summary?.active_period || {}
    if (drivePeriod.tahun_ajaran || !activePeriod?.tahun_ajaran) return
    setDrivePeriod({
      tahun_ajaran: activePeriod.tahun_ajaran || '',
      semester: activePeriod.semester || ''
    })
  }, [drivePeriod.tahun_ajaran, summary?.active_period])

  useEffect(() => {
    if (!superAdminChecked || isSuperAdmin || activeTab !== 'drive') return
    let alive = true
    ;(async () => {
      await Promise.all([loadDriveStatus(), loadDriveFiles()])
    })().catch(() => {
      if (alive) {
        setDriveStatus(DRIVE_STATUS_DEFAULT)
        setDriveFiles([])
      }
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, driveFileBucket, drivePeriod.semester, drivePeriod.tahun_ajaran, isSuperAdmin, superAdminChecked])

  useEffect(() => {
    if (!isSuperAdmin || !selectedTenantId) return
    let alive = true
    fetchTenantDetail(selectedTenantId)
      .then((data) => {
        if (!alive) return
        applyTenantDetail(data)
      })
      .catch((error) => pushToast('error', error?.message || 'Gagal memuat detail storage sekolah'))
    return () => { alive = false }
  }, [isSuperAdmin, selectedTenantId, pushToast])

  const handlePreviewCleanup = async () => {
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

  const handleSaveQuota = async () => {
    if (!selectedTenantId) return
    setSavingQuota(true)
    try {
      const payload = {
        quota_bytes: toBytesFromGb(quotaForm.quotaGb),
        max_upload_bytes: toBytesFromMb(quotaForm.maxUploadMb),
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

  const handleConnectGoogleDrive = async () => {
    setDriveConnecting(true)
    try {
      const returnUrl = (() => {
        if (typeof window === 'undefined') return '/admin/storage?tab=drive'
        const url = new URL(window.location.href)
        url.searchParams.set('tab', 'drive')
        url.hash = ''
        return `${url.origin}${url.pathname}${url.search}`
      })()
      const { data, error } = await supabase.admin.googleDriveConnectUrl({ return_url: returnUrl })
      if (error) throw error
      if (!data?.authorization_url) throw new Error('URL otorisasi Google Drive tidak tersedia')
      window.location.assign(data.authorization_url)
    } catch (error) {
      pushToast('error', error?.message || 'Gagal menyiapkan sambungan Google Drive')
      setDriveConnecting(false)
    }
  }

  const handleSyncGoogleDrive = async () => {
    setDriveSyncing(true)
    try {
      await loadDriveStatus({ sync: true })
      await loadDriveFiles()
      pushToast('success', 'Status Google Drive sekolah berhasil dicek')
    } finally {
      setDriveSyncing(false)
    }
  }

  const handleDisconnectGoogleDrive = async () => {
    const confirmed = window.confirm('Putuskan Google Drive sekolah? Upload berikutnya akan kembali ke storage VPS/object storage sampai disambungkan lagi.')
    if (!confirmed) return

    setDriveDisconnecting(true)
    try {
      const { data, error } = await supabase.admin.disconnectGoogleDrive()
      if (error) throw error
      setDriveStatus(normalizeDriveStatus(data))
      await loadDriveFiles()
      pushToast('success', 'Google Drive sekolah berhasil diputuskan')
    } catch (error) {
      pushToast('error', error?.message || 'Gagal memutuskan Google Drive')
    } finally {
      setDriveDisconnecting(false)
    }
  }

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
              {isSuperAdmin ? 'Kontrol Storage Platform' : 'Storage & Google Drive'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Kelola VPS storage, kuota sekolah, Google Drive, inventaris file, rekomendasi cleanup, dan Trash dari satu halaman.
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

        {!isSuperAdmin && (
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
              onClick={() => setActiveTab('drive')}
              className={`inline-flex min-w-max items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold ${activeTab === 'drive' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <Cloud size={16} />
              Google Drive
            </button>
          </div>
        )}

        {activeTab === 'drive' && !isSuperAdmin && (
          <section className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatTile icon={Cloud} label="Status Drive" value={driveStatus?.status_label || 'Belum tersambung'} hint={driveStatus?.account_email || 'Akun belum tersambung'} />
              <StatTile icon={Database} label="Storage Periode" value={labelOrZero(driveFilteredStorage.uploaded_label)} hint={`${numberFormatter.format(driveFilteredStorage.files || 0)} file`} />
              <StatTile icon={Archive} label="Total EduSmart" value={labelOrZero(driveAllStorage.uploaded_label)} hint={`${numberFormatter.format(driveAllStorage.files || 0)} file`} />
              <StatTile icon={ShieldCheck} label="Quota Drive" value={driveQuotaPercentLabel} hint={`${driveStatus?.quota?.used_label || '0 B'} terpakai`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-slate-900">Google Drive Sekolah</h2>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${driveBadgeClass(driveReady, driveStatus?.status)}`}>
                        {driveLoading ? 'Memuat...' : driveStatus?.status_label || 'Belum tersambung'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Dokumen tugas dan media quiz dapat dialihkan ke Google Drive saat koneksi siap.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleConnectGoogleDrive}
                      disabled={!driveProviderConfigured || driveConnecting || driveSyncing}
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      <Link2 size={16} />
                      {driveConnecting ? 'Menyambungkan...' : driveReady ? 'Sambungkan Ulang' : 'Sambungkan'}
                    </button>
                    <button
                      type="button"
                      onClick={handleSyncGoogleDrive}
                      disabled={!driveProviderConfigured || driveSyncing || driveConnecting}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      <RefreshCw size={16} className={driveSyncing ? 'animate-spin' : ''} />
                      Cek
                    </button>
                    {driveStatus?.folder_url && (
                      <a
                        href={driveStatus.folder_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        <FolderOpen size={16} />
                        Folder
                      </a>
                    )}
                    {driveStatus?.configured && (
                      <button
                        type="button"
                        onClick={handleDisconnectGoogleDrive}
                        disabled={driveDisconnecting || driveConnecting}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                      >
                        <Unplug size={16} />
                        {driveDisconnecting ? 'Memutuskan...' : 'Putuskan'}
                      </button>
                    )}
                  </div>
                </div>

                {!driveProviderConfigured && (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    Credential Google Drive server belum lengkap.
                  </div>
                )}
                {driveStatus?.last_error && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    {driveStatus.last_error}
                  </div>
                )}

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {[
                    ['Provider server', driveProviderConfigured, driveProviderConfigured ? 'Credential tersedia' : 'Credential belum lengkap'],
                    ['Akun sekolah', Boolean(driveStatus?.configured), driveStatus?.account_email || 'Belum tersambung'],
                    ['Folder root', driveReady, driveStatus?.folder_name || 'Folder belum dibuat'],
                    ['Berbagi link', Boolean(driveStatus?.share_uploaded_files), driveStatus?.share_uploaded_files ? 'Link file otomatis siap dibuka' : 'Berbagi link dimatikan']
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

                <div className="mt-4">
                  <ProgressLine label="Pemakaian quota Google Drive" value={driveQuotaPercentLabel} percent={driveQuotaBarWidth} />
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-bold text-slate-900">Filter Drive</h2>
                <div className="mt-3 space-y-3">
                  <input
                    value={drivePeriod.tahun_ajaran}
                    onChange={(event) => setDrivePeriod((prev) => ({ ...prev, tahun_ajaran: event.target.value }))}
                    placeholder="Tahun ajaran, contoh 2025/2026"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                  <select
                    value={drivePeriod.semester}
                    onChange={(event) => setDrivePeriod((prev) => ({ ...prev, semester: event.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="">Semua semester</option>
                    <option value="Ganjil">Ganjil</option>
                    <option value="Genap">Genap</option>
                  </select>
                  <select
                    value={driveFileBucket}
                    onChange={(event) => setDriveFileBucket(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    {DRIVE_FILE_BUCKET_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  <input
                    type="search"
                    value={driveFileSearch}
                    onChange={(event) => setDriveFileSearch(event.target.value)}
                    placeholder="Cari file, kelas, periode"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              </section>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-bold text-slate-900">Pemakaian Per Kelas</h2>
                <div className="mt-3 space-y-2">
                  {driveClassUsageRows.slice(0, 10).map((row, index) => (
                    <div key={`${row.kelas || 'kelas'}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{row.kelas || 'Tanpa kelas'}</p>
                        <p className="text-xs text-slate-500">{numberFormatter.format(row.files || 0)} file · Angkatan {row.angkatan || '-'}</p>
                      </div>
                      <span className="text-sm font-bold text-slate-700">{row.uploaded_label || '0 B'}</span>
                    </div>
                  ))}
                  {driveClassUsageRows.length === 0 && <p className="text-sm text-slate-500">Belum ada upload Drive pada filter ini.</p>}
                </div>
                {driveSemesterUsageRows.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {driveSemesterUsageRows.slice(0, 6).map((row, index) => (
                      <span key={`${row.tahun_ajaran}-${row.semester}-${index}`} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                        {row.tahun_ajaran || '-'} {row.semester || '-'}: {row.uploaded_label || '0 B'}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-bold text-slate-900">Inventaris File Drive</h2>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    <FileText size={14} />
                    {driveFilesLoading ? 'Memuat' : `${numberFormatter.format(driveVisibleFiles.length)} file`}
                  </span>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="py-2 pr-3">File</th>
                        <th className="py-2 pr-3">Konteks</th>
                        <th className="py-2 pr-3 text-right">Ukuran</th>
                        <th className="py-2 pr-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {driveVisibleFiles.map((file) => (
                        <tr key={file.id} className="border-t border-slate-100">
                          <td className="py-3 pr-3">
                            <p className="max-w-[260px] truncate font-semibold text-slate-900">{file.drive_file_name || 'Tanpa nama'}</p>
                            <p className="text-xs text-slate-500">{file.module_label || file.bucket || 'File'} {file.extension ? `.${file.extension}` : ''}</p>
                          </td>
                          <td className="py-3 pr-3 text-xs text-slate-600">
                            <p>{file.tahun_ajaran || '-'} / {file.semester || '-'}</p>
                            <p>{file.kelas || 'Tanpa kelas'}</p>
                          </td>
                          <td className="py-3 pr-3 text-right font-semibold text-slate-900">{file.size_label || '0 B'}</td>
                          <td className="py-3 pr-3 text-right">
                            {file.drive_web_view_link ? (
                              <a href={file.drive_web_view_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                                <ExternalLink size={14} />
                                Buka
                              </a>
                            ) : <span className="text-xs text-slate-400">-</span>}
                          </td>
                        </tr>
                      ))}
                      {!driveFilesLoading && driveVisibleFiles.length === 0 && (
                        <tr>
                          <td className="py-8 text-center text-slate-500" colSpan={4}>Belum ada file Google Drive pada filter ini.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
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
                      <th className="py-2 pr-3">Terpakai</th>
                      <th className="py-2 pr-3">Kuota</th>
                      <th className="py-2 pr-3">Kategori</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.map((tenant) => (
                      <tr
                        key={tenant.id}
                        onClick={() => setSelectedTenantId(tenant.id)}
                        className={`cursor-pointer border-t border-slate-100 ${selectedTenantId === tenant.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                      >
                        <td className="py-3 pr-3">
                          <p className="font-semibold text-slate-900">{tenant.name}</p>
                          <p className="text-xs text-slate-500">{tenant.slug}</p>
                        </td>
                        <td className="py-3 pr-3 font-medium text-slate-700">{tenant.usage?.total_label || '0 B'}</td>
                        <td className="py-3 pr-3 text-slate-600">{tenant.quota?.quota_label || '-'}</td>
                        <td className="py-3 pr-3 text-slate-600">{tenant.top_category?.label || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">Kuota Sekolah</h2>
              <p className="mt-1 text-xs text-slate-500">{selectedTenant?.name || 'Pilih sekolah dari tabel.'}</p>
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-semibold text-slate-600">
                  Kuota sekolah (GB)
                  <input
                    value={quotaForm.quotaGb}
                    onChange={(e) => setQuotaForm((prev) => ({ ...prev, quotaGb: e.target.value }))}
                    placeholder="contoh: 30"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-600">
                  Maks upload per file (MB)
                  <input
                    value={quotaForm.maxUploadMb}
                    onChange={(e) => setQuotaForm((prev) => ({ ...prev, maxUploadMb: e.target.value }))}
                    placeholder="contoh: 15"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </label>
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
          <StatTile icon={HardDrive} label="Storage Terpakai" value={usage.total_label || quota.used_label} hint={`${numberFormatter.format(usage.total_files || 0)} file`} />
          <StatTile icon={Database} label="Kuota" value={quota.quota_label} hint={quota.percent !== null && quota.percent !== undefined ? `${quota.percent}% terpakai` : 'Belum dibatasi'} />
          <StatTile icon={Archive} label="Sisa Storage" value={quota.remaining_label} />
          <StatTile icon={Trash2} label="Trash" value={activeSummary?.trash?.bytes_label || '0 B'} hint={`${numberFormatter.format(activeSummary?.trash?.files || 0)} file`} />
        </div>

        {quota.percent !== null && quota.percent !== undefined && (
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <ProgressLine label="Pemakaian kuota sekolah" value={`${quota.percent}%`} percent={quota.percent} />
          </section>
        )}

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

        <section className="rounded-lg border border-rose-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-slate-900">Cleanup Aman ke Trash</h2>
            <p className="text-xs text-slate-500">
              Sistem menolak cleanup semester aktif. File masuk Trash dulu dan otomatis dapat dipurge setelah 30 hari.
            </p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-5">
            <input
              value={cleanupForm.tahun_ajaran}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, tahun_ajaran: e.target.value }))}
              placeholder="2023/2024"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <select
              value={cleanupForm.semester}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, semester: e.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {SEMESTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select
              value={cleanupForm.category}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, category: e.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <input
              value={cleanupForm.older_than_days}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, older_than_days: e.target.value }))}
              placeholder="Lebih dari berapa hari"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={cleanupForm.largest_percent}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, largest_percent: e.target.value }))}
              placeholder="% file terbesar"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handlePreviewCleanup}
              disabled={cleanupLoading || (isSuperAdmin && !selectedTenantId)}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
            >
              <Trash2 size={16} />
              {cleanupLoading ? 'Memproses...' : 'Preview Cleanup'}
            </button>
            <button
              type="button"
              onClick={handleExecuteCleanup}
              disabled={cleanupLoading || !cleanupPreview?.allowed || cleanupPreview?.files <= 0}
              className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              Pindahkan ke Trash
            </button>
          </div>
          {cleanupPreview && (
            <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${cleanupPreview.allowed ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              {cleanupPreview.message} Kandidat: {numberFormatter.format(cleanupPreview.files || 0)} file ({cleanupPreview.bytes_label || '0 B'}).
            </div>
          )}
        </section>
          </>
        )}
      </div>
    </div>
  )
}

export default StorageManager
