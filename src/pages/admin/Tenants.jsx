import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'
import PasswordInput from '../../components/PasswordInput'
import { loadExcelJsBrowser } from '../../utils/excelBrowser'

const slugify = (value = '') =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)

const getRootDomain = () => {
  const configured = import.meta.env.VITE_ROOT_DOMAIN
  if (configured) return configured
  if (typeof window === 'undefined') return ''
  return window.location.hostname || ''
}

const numberFormatter = new Intl.NumberFormat('id-ID')

const BACKUP_MODE_OPTIONS = [
  {
    value: 'students',
    label: 'Backup Siswa: Nilai + Kehadiran + Eskul'
  },
  {
    value: 'teachers',
    label: 'Backup Guru: Pengampu + Nilai/Kehadiran + Eskul'
  },
  {
    value: 'full',
    label: 'Backup Super Lengkap (Semua Data Tenant)'
  }
]

const getBackupModeLabel = (value) =>
  BACKUP_MODE_OPTIONS.find((item) => item.value === value)?.label || 'Backup Data Tenant'

const BACKUP_PERIOD_OPTIONS = [
  { value: 'all', label: 'Semua Data' },
  { value: '1', label: '1 Bulan Terakhir' },
  { value: '3', label: '3 Bulan Terakhir' },
  { value: '6', label: '6 Bulan Terakhir' },
  { value: '12', label: '12 Bulan Terakhir' },
  { value: '24', label: '24 Bulan Terakhir' }
]

const TENANT_STATUS_OPTIONS = [
  { value: 'active', label: 'Aktif' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'archived', label: 'Archived' }
]

const tenantStatusBadgeClass = (status) => {
  if (status === 'active') return 'bg-emerald-100 text-emerald-700'
  if (status === 'suspended') return 'bg-amber-100 text-amber-700'
  if (status === 'archived') return 'bg-rose-100 text-rose-700'
  return 'bg-slate-100 text-slate-600'
}

const toNumber = (value) => Number(value || 0)

const formatBytes = (bytes) => {
  const value = Number(bytes || 0)
  if (!Number.isFinite(value) || value <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let idx = 0

  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024
    idx += 1
  }

  const precision = idx === 0 ? 0 : 2
  return `${Number(size.toFixed(precision)).toLocaleString('id-ID')} ${units[idx]}`
}

const toCellValue = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return String(value)
}

const sanitizeSheetName = (value = 'Sheet') => {
  const name = String(value)
    .replace(/[\\/*?:[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (name || 'Sheet').slice(0, 31)
}

const buildUniqueSheetName = (baseName, usedNames) => {
  let candidate = sanitizeSheetName(baseName)
  if (!usedNames.has(candidate)) {
    usedNames.add(candidate)
    return candidate
  }

  let suffix = 2
  while (suffix <= 999) {
    const tail = ` (${suffix})`
    const next = `${candidate.slice(0, 31 - tail.length)}${tail}`
    if (!usedNames.has(next)) {
      usedNames.add(next)
      return next
    }
    suffix += 1
  }

  const fallback = `${Date.now()}`.slice(-6)
  const fallbackName = `${candidate.slice(0, 24)}-${fallback}`.slice(0, 31)
  usedNames.add(fallbackName)
  return fallbackName
}

const applyHeaderStyle = (worksheet, columnCount) => {
  const header = worksheet.getRow(1)
  header.font = { bold: true, color: { argb: 'FF0F172A' } }
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' }
  }

  for (let i = 1; i <= columnCount; i += 1) {
    const cell = header.getCell(i)
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    }
  }
}

const setColumnWidths = (worksheet, keys, rows) => {
  const sampleSize = Math.min(rows.length, 120)

  keys.forEach((key, index) => {
    let width = Math.max(12, String(key).length + 2)
    for (let i = 0; i < sampleSize; i += 1) {
      const len = String(toCellValue(rows[i]?.[key])).length + 2
      if (len > width) width = len
      if (width >= 60) break
    }
    worksheet.getColumn(index + 1).width = Math.min(60, width)
  })
}

const buildBackupFileName = (tenant = {}, mode = 'full') => {
  const slug = String(tenant?.slug || 'tenant')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  const modeSafe = String(mode || 'full')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `backup-${slug || 'tenant'}-${modeSafe || 'full'}-${stamp}.xlsx`
}

const createWorkbookBufferFromBackupPayload = async (payload) => {
  const ExcelJS = await loadExcelJsBrowser()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'EduSmart Super Admin'
  workbook.created = new Date()

  const usedSheetNames = new Set()
  const tenant = payload?.tenant || {}
  const tables = Array.isArray(payload?.tables) ? payload.tables : []
  const summary = payload?.summary || {}

  const summarySheet = workbook.addWorksheet(buildUniqueSheetName('Ringkasan Backup', usedSheetNames))
  summarySheet.columns = [
    { header: 'Field', key: 'field', width: 36 },
    { header: 'Nilai', key: 'value', width: 70 }
  ]
  summarySheet.addRows([
    { field: 'Tenant ID', value: tenant?.id || '-' },
    { field: 'Nama Tenant', value: tenant?.name || '-' },
    { field: 'Slug Tenant', value: tenant?.slug || '-' },
    { field: 'Status Tenant', value: tenant?.status || '-' },
    { field: 'Mode Backup', value: payload?.mode_label || payload?.mode || '-' },
    { field: 'Periode Data', value: payload?.period?.label || '-' },
    { field: 'Awal Periode', value: payload?.period?.start_at || '-' },
    { field: 'Akhir Periode', value: payload?.period?.end_at || '-' },
    { field: 'Exported At', value: payload?.exported_at || '-' },
    { field: 'Jumlah Tabel', value: toCellValue(summary?.table_count) },
    { field: 'Total Baris Data', value: toCellValue(summary?.total_rows) }
  ])
  applyHeaderStyle(summarySheet, 2)
  summarySheet.views = [{ state: 'frozen', ySplit: 1 }]

  const tableListSheet = workbook.addWorksheet(buildUniqueSheetName('Daftar Tabel', usedSheetNames))
  tableListSheet.columns = [
    { header: 'No', key: 'no', width: 8 },
    { header: 'Nama Tabel', key: 'table', width: 38 },
    { header: 'Jumlah Baris', key: 'rows', width: 18 }
  ]
  tableListSheet.addRows(
    tables.map((table, index) => ({
      no: index + 1,
      table: table?.name || '-',
      rows: Number(table?.row_count || 0)
    }))
  )
  applyHeaderStyle(tableListSheet, 3)
  tableListSheet.views = [{ state: 'frozen', ySplit: 1 }]

  tables.forEach((table) => {
    const tableName = table?.name || 'data'
    const rows = Array.isArray(table?.rows) ? table.rows : []
    const worksheet = workbook.addWorksheet(buildUniqueSheetName(tableName, usedSheetNames))

    if (rows.length === 0) {
      worksheet.columns = [
        { header: 'Informasi', key: 'message', width: 60 }
      ]
      worksheet.addRow({ message: 'Tidak ada data pada tabel ini' })
      applyHeaderStyle(worksheet, 1)
      worksheet.views = [{ state: 'frozen', ySplit: 1 }]
      return
    }

    const keys = []
    const keySet = new Set()
    rows.forEach((row) => {
      Object.keys(row || {}).forEach((key) => {
        if (!keySet.has(key)) {
          keySet.add(key)
          keys.push(key)
        }
      })
    })

    worksheet.columns = keys.map((key) => ({
      header: key,
      key
    }))

    rows.forEach((row) => {
      const normalized = {}
      keys.forEach((key) => {
        normalized[key] = toCellValue(row?.[key])
      })
      worksheet.addRow(normalized)
    })

    applyHeaderStyle(worksheet, keys.length)
    setColumnWidths(worksheet, keys, rows)
    worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  })

  return workbook.xlsx.writeBuffer()
}

const triggerExcelDownload = (buffer, filename) => {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

const statCardsFrom = (stats = {}) => [
  { key: 'total_users', label: 'Total User', value: toNumber(stats.total_users) },
  { key: 'total_siswa', label: 'Siswa', value: toNumber(stats.total_siswa) },
  { key: 'total_guru', label: 'Guru', value: toNumber(stats.total_guru) },
  { key: 'total_admin', label: 'Admin', value: toNumber(stats.total_admin) },
  { key: 'total_aktif', label: 'Status Aktif', value: toNumber(stats.total_aktif) },
  { key: 'total_nonaktif', label: 'Status Nonaktif', value: toNumber(stats.total_nonaktif) },
  { key: 'online_users', label: 'Online (2 menit)', value: toNumber(stats.online_users) }
]

const Tenants = () => {
  const { isSuperAdmin, superAdminChecked } = useAuthStore()
  const { pushToast } = useUIStore()

  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [slugTouched, setSlugTouched] = useState(false)

  const [selectedTenantId, setSelectedTenantId] = useState('')
  const [tenantDetail, setTenantDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailRefreshing, setDetailRefreshing] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [resetLoadingByUser, setResetLoadingByUser] = useState({})
  const [primaryAdminSavingByUser, setPrimaryAdminSavingByUser] = useState({})
  const [temporaryPasswords, setTemporaryPasswords] = useState({})
  const [backupLoading, setBackupLoading] = useState(false)
  const [backupMode, setBackupMode] = useState('full')
  const [backupMonths, setBackupMonths] = useState('all')
  const [statusSaving, setStatusSaving] = useState(false)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [restoreApplying, setRestoreApplying] = useState(false)
  const [restoreFileName, setRestoreFileName] = useState('')
  const [restorePayload, setRestorePayload] = useState(null)
  const [restorePreview, setRestorePreview] = useState(null)
  const [restoreIncludeTables, setRestoreIncludeTables] = useState('')

  const [form, setForm] = useState({
    name: '',
    slug: '',
    adminName: '',
    adminEmail: '',
    adminPassword: ''
  })

  const rootDomain = useMemo(() => getRootDomain(), [])
  const previewDomain = form.slug && rootDomain ? `${form.slug}.${rootDomain}` : ''

  const loadTenants = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.super.tenants()
      if (error) throw error
      setTenants(Array.isArray(data) ? data : [])
    } catch (err) {
      pushToast('error', err?.message || 'Gagal memuat daftar sekolah')
    } finally {
      setLoading(false)
    }
  }

  const loadTenantDetail = async (tenantId, options = {}) => {
    if (!tenantId) return
    const silent = Boolean(options?.silent)
    const suppressToast = Boolean(options?.suppressToast)

    if (silent) {
      setDetailRefreshing(true)
    } else {
      setDetailLoading(true)
      setTenantDetail(null)
    }

    setDetailError('')

    try {
      const { data, error } = await supabase.super.tenantDetail(tenantId)
      if (error) throw error
      setTenantDetail(data || null)
    } catch (err) {
      const message = err?.message || 'Gagal memuat detail sekolah'
      setDetailError(message)
      if (!silent) {
        setTenantDetail(null)
      }
      if (!suppressToast) {
        pushToast('error', message)
      }
    } finally {
      if (silent) {
        setDetailRefreshing(false)
      } else {
        setDetailLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!superAdminChecked || !isSuperAdmin) return
    loadTenants()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [superAdminChecked, isSuperAdmin])

  useEffect(() => {
    if (!selectedTenantId) return undefined
    const intervalId = window.setInterval(() => {
      loadTenantDetail(selectedTenantId, { silent: true, suppressToast: true })
    }, 15000)

    return () => window.clearInterval(intervalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId])

  const handleChange = (field) => (e) => {
    const value = e.target.value
    setForm((prev) => {
      const next = { ...prev, [field]: value }
      if (field === 'name' && !slugTouched) {
        next.slug = slugify(value)
      }
      if (field === 'slug') {
        next.slug = slugify(value)
      }
      return next
    })
    if (field === 'slug') setSlugTouched(true)
  }

  const resetForm = () => {
    setForm({
      name: '',
      slug: '',
      adminName: '',
      adminEmail: '',
      adminPassword: ''
    })
    setSlugTouched(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (saving) return

    if (!form.name || !form.slug || !form.adminName || !form.adminEmail || !form.adminPassword) {
      pushToast('error', 'Lengkapi semua field terlebih dahulu')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        admin_name: form.adminName.trim(),
        admin_email: form.adminEmail.trim(),
        admin_password: form.adminPassword
      }
      const { data, error } = await supabase.super.createTenant(payload)
      if (error) throw error

      pushToast('success', 'Sekolah berhasil dibuat')
      resetForm()
      await loadTenants()

      const newTenantId = data?.tenant?.id
      if (newTenantId) {
        setSelectedTenantId(newTenantId)
        setTemporaryPasswords({})
        await loadTenantDetail(newTenantId)
      }

      if (data?.admin?.email) {
        pushToast('info', `Admin sekolah: ${data.admin.email}`)
      }
    } catch (err) {
      pushToast('error', err?.message || 'Gagal membuat sekolah')
    } finally {
      setSaving(false)
    }
  }

  const handleSelectTenant = async (tenantId) => {
    if (!tenantId) return
    setSelectedTenantId(tenantId)
    setTemporaryPasswords({})
    setPrimaryAdminSavingByUser({})
    setRestorePreview(null)
    setRestorePayload(null)
    setRestoreFileName('')
    setRestoreIncludeTables('')
    await loadTenantDetail(tenantId)
  }

  const handleRefreshDetail = async () => {
    if (!selectedTenantId) return
    await loadTenantDetail(selectedTenantId, { silent: true })
  }

  const handleBackupTenant = async () => {
    const tenantId = tenantDetail?.tenant?.id || selectedTenantId
    if (!tenantId || backupLoading) return

    setBackupLoading(true)
    try {
      const selectedMode = String(backupMode || 'full').trim() || 'full'
      const selectedMonths =
        selectedMode === 'students' && backupMonths !== 'all' ? Number(backupMonths) : undefined

      const { data, error } = await supabase.super.tenantBackup(tenantId, {
        mode: selectedMode,
        months: selectedMonths
      })
      if (error) throw error
      if (!data || !Array.isArray(data.tables)) {
        throw new Error('Data backup tenant tidak valid')
      }

      const buffer = await createWorkbookBufferFromBackupPayload(data)
      const filename = buildBackupFileName(data?.tenant, data?.mode || selectedMode)
      triggerExcelDownload(buffer, filename)
      const modeLabel = data?.mode_label || getBackupModeLabel(data?.mode || selectedMode)
      const periodLabel = data?.period?.label ? ` (${data.period.label})` : ''
      pushToast('success', `${modeLabel}${periodLabel} berhasil diunduh: ${filename}`)
    } catch (err) {
      pushToast('error', err?.message || 'Gagal membuat backup tenant')
    } finally {
      setBackupLoading(false)
    }
  }

  const parseRestoreIncludeTables = () => {
    return restoreIncludeTables
      .split(/[,;\n\r]+/g)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  const handleTenantStatusUpdate = async (nextStatus) => {
    const tenantId = tenantDetail?.tenant?.id || selectedTenantId
    const currentStatus = String(tenantDetail?.tenant?.status || '').toLowerCase()
    if (!tenantId || !nextStatus || statusSaving) return

    if (currentStatus === nextStatus) {
      pushToast('info', `Status tenant sudah ${nextStatus}`)
      return
    }

    let reason = ''
    if (nextStatus !== 'active') {
      reason = window.prompt('Alasan perubahan status tenant (opsional):', '') || ''
    }

    const confirmed = window.confirm(
      `Ubah status tenant menjadi ${nextStatus}? ${
        nextStatus === 'active' ? 'Tenant akan bisa login kembali.' : 'Login tenant akan diblokir.'
      }`
    )
    if (!confirmed) return

    setStatusSaving(true)
    try {
      const { data, error } = await supabase.super.updateTenantStatus(tenantId, {
        status: nextStatus,
        reason: reason || undefined
      })
      if (error) throw error

      pushToast('success', `Status tenant diubah ke ${nextStatus}`)
      if (data) {
        setTenantDetail((prev) => {
          if (!prev) return prev
          return { ...prev, tenant: { ...(prev.tenant || {}), ...data } }
        })
      }
      await loadTenants()
      await loadTenantDetail(tenantId, { silent: true, suppressToast: true })
    } catch (err) {
      pushToast('error', err?.message || 'Gagal mengubah status tenant')
    } finally {
      setStatusSaving(false)
    }
  }

  const handleRestoreFileChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (!parsed || !Array.isArray(parsed.tables)) {
        throw new Error('Format JSON backup tidak valid (tables tidak ditemukan)')
      }

      setRestorePayload(parsed)
      setRestoreFileName(file.name || 'backup.json')
      setRestorePreview(null)
      pushToast('success', `File backup siap dipreview: ${file.name}`)
    } catch (err) {
      setRestorePayload(null)
      setRestoreFileName('')
      setRestorePreview(null)
      pushToast('error', err?.message || 'Gagal membaca file backup JSON')
    } finally {
      event.target.value = ''
    }
  }

  const handleRestorePreview = async () => {
    const tenantId = tenantDetail?.tenant?.id || selectedTenantId
    if (!tenantId || !restorePayload || restoreLoading) return

    setRestoreLoading(true)
    try {
      const includeTables = parseRestoreIncludeTables()
      const { data, error } = await supabase.super.restoreTenant(tenantId, {
        backup: restorePayload,
        dry_run: true,
        include_tables: includeTables.length ? includeTables : undefined
      })
      if (error) throw error
      setRestorePreview(data?.result || null)
      pushToast('success', 'Dry-run restore selesai. Cek hasil preview sebelum apply.')
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menjalankan dry-run restore')
    } finally {
      setRestoreLoading(false)
    }
  }

  const handleApplyRestore = async () => {
    const tenantId = tenantDetail?.tenant?.id || selectedTenantId
    if (!tenantId || !restorePayload || restoreApplying) return

    const confirmed = window.confirm(
      'Jalankan restore nyata sekarang? Data tenant akan ditimpa sesuai payload backup.'
    )
    if (!confirmed) return

    setRestoreApplying(true)
    try {
      const includeTables = parseRestoreIncludeTables()
      const { data, error } = await supabase.super.restoreTenant(tenantId, {
        backup: restorePayload,
        dry_run: false,
        confirm: true,
        include_tables: includeTables.length ? includeTables : undefined
      })
      if (error) throw error

      setRestorePreview(data?.result || null)
      pushToast('success', 'Restore selesai diterapkan ke tenant.')
      await loadTenantDetail(tenantId, { silent: true, suppressToast: true })
    } catch (err) {
      pushToast('error', err?.message || 'Gagal apply restore tenant')
    } finally {
      setRestoreApplying(false)
    }
  }

  const handleResetTenantAdminPassword = async (admin) => {
    const tenantId = tenantDetail?.tenant?.id || selectedTenantId
    const userId = admin?.user_id
    if (!tenantId || !userId) return

    const label = admin?.email || admin?.name || userId
    const confirmed = window.confirm(
      `Reset password admin ${label}? Password lama akan langsung tidak berlaku.`
    )
    if (!confirmed) return

    setResetLoadingByUser((prev) => ({ ...prev, [userId]: true }))
    try {
      const { data, error } = await supabase.super.resetTenantAdminPassword(tenantId, userId)
      if (error) throw error

      if (data?.temporary_password) {
        setTemporaryPasswords((prev) => ({
          ...prev,
          [userId]: data.temporary_password
        }))
      }

      pushToast('success', `Password admin ${label} berhasil direset`)
      await loadTenantDetail(tenantId, { silent: true })
    } catch (err) {
      pushToast('error', err?.message || 'Gagal reset password admin')
    } finally {
      setResetLoadingByUser((prev) => {
        const next = { ...prev }
        delete next[userId]
        return next
      })
    }
  }

  const handleSetPrimaryAdmin = async (admin) => {
    const tenantId = tenantDetail?.tenant?.id || selectedTenantId
    const userId = admin?.user_id
    if (!tenantId || !userId) return

    if (admin?.is_primary_admin) {
      pushToast('info', `${admin?.name || admin?.email || 'Admin'} sudah menjadi admin utama`)
      return
    }

    const label = admin?.email || admin?.name || userId
    const confirmed = window.confirm(
      `Jadikan ${label} sebagai Admin Utama tenant? Akun ini akan bisa menyimpan perubahan kritikal tanpa approval.`
    )
    if (!confirmed) return

    setPrimaryAdminSavingByUser((prev) => ({ ...prev, [userId]: true }))
    try {
      const { data, error } = await supabase.super.setTenantPrimaryAdmin(tenantId, userId)
      if (error) throw error

      const primaryId = data?.primary_admin_user_id || userId
      setTenantDetail((prev) => {
        if (!prev) return prev
        const nextAdmins = Array.isArray(prev.admins)
          ? prev.admins.map((row) => ({
              ...row,
              is_primary_admin: String(row?.user_id || '') === String(primaryId)
            }))
          : prev.admins

        return {
          ...prev,
          tenant: {
            ...(prev.tenant || {}),
            primary_admin_user_id: primaryId,
            primary_admin_name: data?.primary_admin_name || null,
            primary_admin_email: data?.primary_admin_email || null
          },
          admins: nextAdmins
        }
      })

      pushToast('success', `${data?.primary_admin_name || label} ditetapkan sebagai admin utama`)
      await loadTenantDetail(tenantId, { silent: true, suppressToast: true })
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menetapkan admin utama tenant')
    } finally {
      setPrimaryAdminSavingByUser((prev) => {
        const next = { ...prev }
        delete next[userId]
        return next
      })
    }
  }

  if (!superAdminChecked) {
    return (
      <div className="p-6">
        <div className="text-sm text-slate-500">Memuat akses super admin...</div>
      </div>
    )
  }

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <h2 className="text-lg font-bold text-slate-900">Akses ditolak</h2>
          <p className="text-sm text-slate-600 mt-2">
            Halaman ini khusus untuk Super Admin.
          </p>
        </div>
      </div>
    )
  }

  const detailTenant = tenantDetail?.tenant
  const detailStats = tenantDetail?.stats || {}
  const detailAdmins = Array.isArray(tenantDetail?.admins) ? tenantDetail.admins : []
  const detailStorage = tenantDetail?.storage || {}
  const storageBuckets = Array.isArray(detailStorage?.buckets) ? detailStorage.buckets : []
  const primaryAdminUserId = String(detailTenant?.primary_admin_user_id || '')
  const primaryAdminInfo = detailAdmins.find(
    (admin) => String(admin?.user_id || '') === primaryAdminUserId
  )

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Panel Super Admin</h1>
        <p className="text-sm text-slate-600">
          Buat sekolah baru, lihat ringkasan tenant, dan kelola admin sekolah.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Buat Sekolah</h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Nama Sekolah</label>
            <input
              type="text"
              value={form.name}
              onChange={handleChange('name')}
              placeholder="Contoh: SMA Negeri 1"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Subdomain Sekolah</label>
            <input
              type="text"
              value={form.slug}
              onChange={handleChange('slug')}
              placeholder="contoh: sma1"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {previewDomain && (
              <p className="text-xs text-slate-500">
                URL sekolah: <span className="font-semibold">{previewDomain}</span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Nama Admin Sekolah</label>
            <input
              type="text"
              value={form.adminName}
              onChange={handleChange('adminName')}
              placeholder="Nama admin"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Email Admin</label>
            <input
              type="email"
              value={form.adminEmail}
              onChange={handleChange('adminEmail')}
              placeholder="admin@sekolah.com"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Password Admin</label>
            <PasswordInput
              value={form.adminPassword}
              onChange={handleChange('adminPassword')}
              placeholder="Minimal 6 karakter"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={saving}
              className="w-full md:w-auto px-5 py-2.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? 'Menyimpan...' : 'Buat Sekolah'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Daftar Sekolah</h2>
          <button
            type="button"
            onClick={loadTenants}
            className="text-xs px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500">Memuat data sekolah...</div>
        ) : tenants.length === 0 ? (
          <div className="text-sm text-slate-500">Belum ada sekolah.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2 pr-4">Sekolah</th>
                  <th className="py-2 pr-4">Subdomain</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Dibuat</th>
                  <th className="py-2 pr-4">Aksi</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {tenants.map((tenant) => (
                  <tr
                    key={tenant.id}
                    className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${
                      selectedTenantId === tenant.id ? 'bg-indigo-50/70' : ''
                    }`}
                    onClick={() => handleSelectTenant(tenant.id)}
                  >
                    <td className="py-2 pr-4 font-semibold text-slate-900">{tenant.name || '-'}</td>
                    <td className="py-2 pr-4">
                      {tenant.slug ? `${tenant.slug}.${rootDomain}` : '-'}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${tenantStatusBadgeClass(
                          tenant.status
                        )}`}
                      >
                        {tenant.status || 'unknown'}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-slate-500">{formatDateTime(tenant.created_at)}</td>
                    <td className="py-2 pr-4">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSelectTenant(tenant.id)
                        }}
                        className="text-xs px-3 py-1.5 rounded-full border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                      >
                        Detail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedTenantId && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {detailTenant?.name || 'Detail Sekolah'}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {detailTenant?.slug ? `${detailTenant.slug}.${rootDomain}` : '-'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${tenantStatusBadgeClass(
                    detailTenant?.status
                  )}`}
                >
                  {detailTenant?.status || 'unknown'}
                </span>
                {detailTenant?.status_reason && (
                  <span className="text-xs text-slate-500">
                    Alasan: {detailTenant.status_reason}
                  </span>
                )}
                {detailTenant?.status_changed_at && (
                  <span className="text-xs text-slate-400">
                    Update: {formatDateTime(detailTenant.status_changed_at)}
                  </span>
                )}
                <span className="text-xs text-indigo-700 bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded-full">
                  Admin Utama:{' '}
                  {primaryAdminInfo?.name ||
                    primaryAdminInfo?.email ||
                    detailTenant?.primary_admin_name ||
                    'Belum ditetapkan'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden lg:flex items-center gap-1">
                {TENANT_STATUS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleTenantStatusUpdate(option.value)}
                    disabled={statusSaving || detailLoading || detailTenant?.status === option.value}
                    className={`text-xs px-3 py-1.5 rounded-full border disabled:opacity-60 ${
                      option.value === 'active'
                        ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                        : option.value === 'suspended'
                          ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                          : 'border-rose-200 text-rose-700 hover:bg-rose-50'
                    }`}
                  >
                    {statusSaving && detailTenant?.status !== option.value
                      ? 'Menyimpan...'
                      : option.label}
                  </button>
                ))}
              </div>
              <div className="lg:hidden">
                <select
                  value={detailTenant?.status || ''}
                  onChange={(e) => handleTenantStatusUpdate(e.target.value)}
                  disabled={statusSaving || detailLoading}
                  className="text-xs px-2.5 py-1.5 rounded-full border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
                >
                  {TENANT_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="tenant-backup-mode" className="text-xs font-semibold text-slate-600">
                  Mode Backup
                </label>
                <select
                  id="tenant-backup-mode"
                  value={backupMode}
                  onChange={(e) => {
                    const nextMode = e.target.value
                    setBackupMode(nextMode)
                    if (nextMode !== 'students') {
                      setBackupMonths('all')
                    }
                  }}
                  disabled={backupLoading || detailLoading}
                  className="text-xs px-2.5 py-1.5 rounded-full border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
                >
                  {BACKUP_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {backupMode === 'students' && (
                <div className="flex items-center gap-2">
                  <label htmlFor="tenant-backup-period" className="text-xs font-semibold text-slate-600">
                    Periode
                  </label>
                  <select
                    id="tenant-backup-period"
                    value={backupMonths}
                    onChange={(e) => setBackupMonths(e.target.value)}
                    disabled={backupLoading || detailLoading}
                    className="text-xs px-2.5 py-1.5 rounded-full border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
                  >
                    {BACKUP_PERIOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="button"
                onClick={handleBackupTenant}
                disabled={backupLoading || detailLoading}
                className="text-xs px-3 py-1.5 rounded-full border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
              >
                {backupLoading ? 'Menyiapkan Backup...' : 'Backup Data (Excel)'}
              </button>
              <button
                type="button"
                onClick={handleRefreshDetail}
                disabled={detailRefreshing || detailLoading}
                className="text-xs px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-50 disabled:opacity-60"
              >
                {detailRefreshing ? 'Refresh...' : 'Refresh Detail'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedTenantId('')
                  setTenantDetail(null)
                  setDetailError('')
                  setTemporaryPasswords({})
                  setPrimaryAdminSavingByUser({})
                  setRestorePayload(null)
                  setRestoreFileName('')
                  setRestorePreview(null)
                  setRestoreIncludeTables('')
                }}
                className="text-xs px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-50"
              >
                Tutup
              </button>
            </div>
          </div>

          {detailLoading ? (
            <div className="text-sm text-slate-500">Memuat detail sekolah...</div>
          ) : detailError ? (
            <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-3">
              {detailError}
            </div>
          ) : !tenantDetail ? (
            <div className="text-sm text-slate-500">Data detail belum tersedia.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {statCardsFrom(detailStats).map((item) => (
                  <div key={item.key} className="rounded-xl border border-slate-200 p-4">
                    <p className="text-xs text-slate-500">{item.label}</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">
                      {numberFormatter.format(item.value)}
                    </p>
                  </div>
                ))}
                <div className="rounded-xl border border-slate-200 p-4 col-span-2 lg:col-span-1">
                  <p className="text-xs text-slate-500">Aktivitas Terakhir</p>
                  <p className="text-sm font-semibold text-slate-900 mt-1">
                    {formatDateTime(detailStats.last_activity_at)}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-cyan-200 bg-cyan-50/50 p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Monitoring Storage Tenant (Realtime)</h3>
                  <span className="text-[11px] px-2 py-1 rounded-full bg-cyan-100 text-cyan-800 border border-cyan-200">
                    Auto-refresh 15 detik
                  </span>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-cyan-200 bg-white p-3">
                    <p className="text-xs text-slate-500">Storage Terpakai</p>
                    <p className="text-lg font-bold text-slate-900 mt-1">
                      {detailStorage.total_label || formatBytes(detailStorage.total_bytes)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-cyan-200 bg-white p-3">
                    <p className="text-xs text-slate-500">File Tersimpan</p>
                    <p className="text-lg font-bold text-slate-900 mt-1">
                      {numberFormatter.format(toNumber(detailStorage.resolved_files))}
                    </p>
                  </div>
                  <div className="rounded-xl border border-cyan-200 bg-white p-3">
                    <p className="text-xs text-slate-500">Referensi Tidak Ditemukan</p>
                    <p className="text-lg font-bold text-amber-700 mt-1">
                      {numberFormatter.format(toNumber(detailStorage.unresolved_references))}
                    </p>
                  </div>
                  <div className="rounded-xl border border-cyan-200 bg-white p-3">
                    <p className="text-xs text-slate-500">Update Terakhir</p>
                    <p className="text-sm font-semibold text-slate-900 mt-1">
                      {formatDateTime(detailStorage.computed_at)}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-2 pr-3">Bucket</th>
                        <th className="py-2 pr-3">File</th>
                        <th className="py-2 pr-3">Ukuran</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-700">
                      {storageBuckets.map((bucket) => (
                        <tr key={bucket.bucket} className="border-t border-cyan-100">
                          <td className="py-2 pr-3 font-medium text-slate-900">{bucket.bucket || '-'}</td>
                          <td className="py-2 pr-3">{numberFormatter.format(toNumber(bucket.files))}</td>
                          <td className="py-2 pr-3">
                            {bucket.bytes_label || formatBytes(bucket.bytes)}
                          </td>
                        </tr>
                      ))}
                      {storageBuckets.length === 0 && (
                        <tr>
                          <td colSpan={3} className="py-3 text-slate-500">
                            Belum ada data storage.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Restore Backup Tenant (JSON + Dry-Run)
                  </h3>
                  {restoreFileName ? (
                    <span className="text-xs px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200">
                      File: {restoreFileName}
                    </span>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <div className="lg:col-span-1">
                    <label className="text-xs font-semibold text-slate-600">Upload JSON Backup</label>
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={handleRestoreFileChange}
                      className="mt-1 block w-full text-xs text-slate-600 file:mr-2 file:rounded-full file:border-0 file:bg-indigo-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-indigo-700 hover:file:bg-indigo-200"
                    />
                  </div>
                  <div className="lg:col-span-1">
                    <label className="text-xs font-semibold text-slate-600">
                      Include Tabel (opsional, pisah koma)
                    </label>
                    <input
                      type="text"
                      value={restoreIncludeTables}
                      onChange={(e) => setRestoreIncludeTables(e.target.value)}
                      placeholder="contoh: profiles,kelas,jadwal"
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="lg:col-span-1 flex items-end gap-2">
                    <button
                      type="button"
                      onClick={handleRestorePreview}
                      disabled={!restorePayload || restoreLoading || restoreApplying}
                      className="text-xs px-3 py-2 rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                    >
                      {restoreLoading ? 'Dry-Run...' : 'Preview Dry-Run'}
                    </button>
                    <button
                      type="button"
                      onClick={handleApplyRestore}
                      disabled={!restorePayload || restoreApplying || restoreLoading}
                      className="text-xs px-3 py-2 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                    >
                      {restoreApplying ? 'Applying...' : 'Apply Restore'}
                    </button>
                  </div>
                </div>

                {restorePreview ? (
                  <div className="rounded-xl border border-indigo-200 bg-white p-3 space-y-2">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div className="rounded-lg border border-slate-200 p-2">
                        <p className="text-slate-500">Incoming Rows</p>
                        <p className="font-semibold text-slate-900">
                          {numberFormatter.format(toNumber(restorePreview.summary?.incoming_rows))}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2">
                        <p className="text-slate-500">Would Insert</p>
                        <p className="font-semibold text-indigo-700">
                          {numberFormatter.format(toNumber(restorePreview.summary?.would_insert))}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2">
                        <p className="text-slate-500">Would Update</p>
                        <p className="font-semibold text-indigo-700">
                          {numberFormatter.format(toNumber(restorePreview.summary?.would_update))}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2">
                        <p className="text-slate-500">Errors</p>
                        <p className="font-semibold text-rose-700">
                          {numberFormatter.format(toNumber(restorePreview.summary?.errors))}
                        </p>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="text-left text-slate-500">
                            <th className="py-2 pr-3">Tabel</th>
                            <th className="py-2 pr-3">Incoming</th>
                            <th className="py-2 pr-3">Would Insert</th>
                            <th className="py-2 pr-3">Would Update</th>
                            <th className="py-2 pr-3">Errors</th>
                          </tr>
                        </thead>
                        <tbody className="text-slate-700">
                          {(restorePreview.tables || []).map((item) => (
                            <tr key={item.table} className="border-t border-slate-100">
                              <td className="py-2 pr-3 font-medium text-slate-900">{item.table}</td>
                              <td className="py-2 pr-3">{numberFormatter.format(toNumber(item.incoming_rows))}</td>
                              <td className="py-2 pr-3">{numberFormatter.format(toNumber(item.would_insert || item.inserted))}</td>
                              <td className="py-2 pr-3">{numberFormatter.format(toNumber(item.would_update || item.updated))}</td>
                              <td className="py-2 pr-3 text-rose-700">{numberFormatter.format(toNumber(item.errors))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Jalankan dry-run dulu untuk melihat simulasi insert/update dan error sebelum apply restore.
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                Password lama admin tidak bisa ditampilkan karena tersimpan hash. Gunakan tombol reset untuk
                menghasilkan password baru, lalu lihat dengan ikon mata.
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-2 pr-4">Nama Admin</th>
                      <th className="py-2 pr-4">Email</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Verifikasi Email</th>
                      <th className="py-2 pr-4">Terakhir Aktif</th>
                      <th className="py-2 pr-4">Password</th>
                      <th className="py-2 pr-4">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700">
                    {detailAdmins.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-500">
                          Belum ada admin pada tenant ini.
                        </td>
                      </tr>
                    ) : (
                      detailAdmins.map((admin) => (
                        <tr key={admin.user_id} className="border-t border-slate-100">
                          <td className="py-2 pr-4">
                            <p className="font-semibold text-slate-900">{admin.name || '-'}</p>
                            {admin.is_primary_admin ? (
                              <span className="inline-flex mt-1 text-[11px] px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-100 text-indigo-700">
                                Admin Utama (Bypass Approval)
                              </span>
                            ) : null}
                          </td>
                          <td className="py-2 pr-4">{admin.email || '-'}</td>
                          <td className="py-2 pr-4">
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                admin.status === 'active'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {admin.status || 'unknown'}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-slate-600">
                            {admin.email_verified_at ? 'Terverifikasi' : 'Belum'}
                          </td>
                          <td className="py-2 pr-4 text-slate-500">{formatDateTime(admin.last_seen_at)}</td>
                          <td className="py-2 pr-4 min-w-[220px]">
                            {temporaryPasswords[admin.user_id] ? (
                              <PasswordInput
                                readOnly
                                value={temporaryPasswords[admin.user_id]}
                                className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700"
                                ariaLabelShow="Tampilkan password sementara"
                                ariaLabelHide="Sembunyikan password sementara"
                              />
                            ) : (
                              <span className="text-xs text-slate-400">Belum ada password baru</span>
                            )}
                          </td>
                          <td className="py-2 pr-4">
                            {Boolean(admin.is_super_admin) ? (
                              <span className="text-xs px-3 py-1.5 rounded-full border border-amber-200 text-amber-700 bg-amber-50">
                                Terkunci (Super Admin)
                              </span>
                            ) : (
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleResetTenantAdminPassword(admin)}
                                  disabled={Boolean(resetLoadingByUser[admin.user_id])}
                                  className="text-xs px-3 py-1.5 rounded-full border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                                >
                                  {resetLoadingByUser[admin.user_id] ? 'Reset...' : 'Reset Password'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSetPrimaryAdmin(admin)}
                                  disabled={
                                    Boolean(primaryAdminSavingByUser[admin.user_id]) ||
                                    Boolean(admin.is_primary_admin)
                                  }
                                  className="text-xs px-3 py-1.5 rounded-full border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                                >
                                  {primaryAdminSavingByUser[admin.user_id]
                                    ? 'Menyimpan...'
                                    : admin.is_primary_admin
                                      ? 'Admin Utama'
                                      : 'Jadikan Utama'}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default Tenants
