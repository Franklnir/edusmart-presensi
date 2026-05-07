import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'
import PasswordInput from '../../components/PasswordInput'
import { loadExcelJsBrowser } from '../../utils/excelBrowser'
import rfidArduinoTemplateSource from '../../../docs/esp8266-rfid-mosquitto-tenant.ino?raw'

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

const STANDARD_RFID_MQTT_TOPICS = {
  scan: 'edusmart/{tenant}/rfid/scan',
  response: 'edusmart/{tenant}/rfid/response',
  mode: 'edusmart/{tenant}/rfid/mode'
}

const MQTT_BROKER_PRESETS = [
  {
    key: 'hivemq',
    label: 'HiveMQ Cloud',
    helper: 'TLS verified, port 8883',
    values: {
      port: '8883',
      useTls: true,
      tlsVerifyPeer: true,
      tlsVerifyPeerName: true,
      tlsAllowSelfSigned: false,
      qos: '1',
      clientIdPrefix: 'edusmart-rfid-bridge',
      connectTimeout: '20',
      socketTimeout: '5',
      keepAlive: '20'
    }
  },
  {
    key: 'self-signed',
    label: 'Self-signed TLS',
    helper: 'TLS aktif, verifikasi sertifikat nonaktif',
    values: {
      port: '8883',
      useTls: true,
      tlsVerifyPeer: false,
      tlsVerifyPeerName: false,
      tlsAllowSelfSigned: true,
      qos: '1',
      clientIdPrefix: 'edusmart-rfid-bridge',
      connectTimeout: '20',
      socketTimeout: '5',
      keepAlive: '20'
    }
  }
]

const RFID_MQTT_FORM_DEFAULTS = {
  enabled: true,
  host: '',
  port: '8883',
  username: '',
  password: '',
  clearPassword: false,
  useTls: true,
  tlsVerifyPeer: true,
  tlsVerifyPeerName: true,
  tlsAllowSelfSigned: false,
  qos: '1',
  clientIdPrefix: 'edusmart-rfid-bridge',
  scanTopicTemplate: STANDARD_RFID_MQTT_TOPICS.scan,
  responseTopicTemplate: STANDARD_RFID_MQTT_TOPICS.response,
  modeTopicTemplate: STANDARD_RFID_MQTT_TOPICS.mode,
  connectTimeout: '20',
  socketTimeout: '5',
  keepAlive: '20'
}

const withStandardMqttTopics = (form = {}) => ({
  ...form,
  scanTopicTemplate: STANDARD_RFID_MQTT_TOPICS.scan,
  responseTopicTemplate: STANDARD_RFID_MQTT_TOPICS.response,
  modeTopicTemplate: STANDARD_RFID_MQTT_TOPICS.mode
})

const renderMqttTopicTemplate = (template, tenantSlug = '') => {
  const slug = String(tenantSlug || '').trim() || '{tenant}'
  return String(template || '').replace('{tenant}', slug)
}

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

const domainStatusBadgeClass = (status) => {
  if (status === 'ready') return 'bg-emerald-100 text-emerald-700'
  if (status === 'disabled') return 'bg-rose-100 text-rose-700'
  return 'bg-amber-100 text-amber-700'
}

const dnsStatusBadgeClass = (status) => {
  if (status === 'ready') return 'bg-emerald-100 text-emerald-700'
  if (status === 'missing') return 'bg-amber-100 text-amber-700'
  if (status === 'mismatch') return 'bg-rose-100 text-rose-700'
  return 'bg-slate-100 text-slate-600'
}

const driveStatusBadgeClass = (drive = {}) => {
  if (drive?.ready) return 'bg-emerald-100 text-emerald-700'
  if (drive?.status === 'needs_attention') return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-600'
}

const formatDnsRecords = (records = []) => {
  if (!Array.isArray(records) || records.length === 0) return 'Belum ada record'

  return records
    .map((record) => {
      const host = String(record?.host || '').trim()
      const type = String(record?.type || '').trim()
      const value = String(record?.value || '').trim()
      return [host, type, value].filter(Boolean).join(' ')
    })
    .filter(Boolean)
    .join(' · ')
}

const toNumber = (value) => Number(value || 0)

const escapeCppString = (value = '') =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')

const replaceCStringConst = (source, name, value) =>
  source.replace(
    new RegExp(`const char\\*\\s+${name}\\s*=\\s*"[^"]*";`),
    `const char* ${name} = "${escapeCppString(value)}";`
  )

const replaceNumberConst = (source, name, value) =>
  source.replace(
    new RegExp(`const uint16_t\\s+${name}\\s*=\\s*[^;]+;`),
    `const uint16_t ${name} = ${Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0};`
  )

const replaceBoolConst = (source, name, value) =>
  source.replace(
    new RegExp(`const bool\\s+${name}\\s*=\\s*(true|false);`),
    `const bool ${name} = ${value ? 'true' : 'false'};`
  )

const buildTenantRfidArduinoCode = (template, wifi = {}) => {
  if (!template?.available) return ''
  if (!template?.mqtt?.host || !template?.mqtt?.username || !template?.mqtt?.password) return ''

  let source = rfidArduinoTemplateSource
  source = replaceCStringConst(source, 'WIFI_SSID', wifi?.ssid || 'YOUR_WIFI_SSID')
  source = replaceCStringConst(source, 'WIFI_PASS', wifi?.password || 'YOUR_WIFI_PASSWORD')
  source = replaceCStringConst(source, 'TENANT_SLUG', template?.tenant_slug || '')
  source = replaceCStringConst(source, 'DEVICE_ID', template?.device_id || '')
  source = replaceCStringConst(source, 'FIRMWARE_VERSION', template?.firmware_version || '2.0.0-mqtt-only')
  source = replaceCStringConst(source, 'MQTT_HOST', template?.mqtt?.host || '')
  source = replaceNumberConst(source, 'MQTT_PORT', template?.mqtt?.port || 8883)
  source = replaceCStringConst(source, 'MQTT_USER', template?.mqtt?.username || '')
  source = replaceCStringConst(source, 'MQTT_PASS', template?.mqtt?.password || '')
  source = replaceBoolConst(source, 'MQTT_USE_TLS', template?.mqtt?.use_tls !== false)
  source = replaceBoolConst(source, 'MQTT_TLS_INSECURE', Boolean(template?.mqtt?.tls_allow_self_signed))
  source = replaceCStringConst(source, 'MQTT_TOPIC_SCAN', template?.topics?.scan || '')
  source = replaceCStringConst(source, 'MQTT_TOPIC_RESPONSE', template?.topics?.response || '')
  source = replaceCStringConst(source, 'MQTT_TOPIC_MODE', template?.topics?.mode || '')

  return source
}

const mqttFormFromConfig = (config = {}) =>
  withStandardMqttTopics({
    ...RFID_MQTT_FORM_DEFAULTS,
    enabled: config?.enabled !== false,
    host: String(config?.host || ''),
    port: String(config?.port || RFID_MQTT_FORM_DEFAULTS.port),
    username: String(config?.username || ''),
    password: '',
    clearPassword: false,
    useTls: config?.use_tls !== false,
    tlsVerifyPeer: config?.tls_verify_peer !== false,
    tlsVerifyPeerName: config?.tls_verify_peer_name !== false,
    tlsAllowSelfSigned: Boolean(config?.tls_allow_self_signed),
    qos: String(Number.isFinite(Number(config?.qos)) ? Number(config.qos) : RFID_MQTT_FORM_DEFAULTS.qos),
    clientIdPrefix: String(config?.client_id_prefix || RFID_MQTT_FORM_DEFAULTS.clientIdPrefix),
    connectTimeout: String(config?.connect_timeout || RFID_MQTT_FORM_DEFAULTS.connectTimeout),
    socketTimeout: String(config?.socket_timeout || RFID_MQTT_FORM_DEFAULTS.socketTimeout),
    keepAlive: String(config?.keep_alive || RFID_MQTT_FORM_DEFAULTS.keepAlive)
  })

const copyText = async (text) => {
  const value = String(text || '')
  if (!value) return false

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return true
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'readonly')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}

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
  const [mqttForm, setMqttForm] = useState(RFID_MQTT_FORM_DEFAULTS)
  const [mqttSaving, setMqttSaving] = useState(false)
  const [mosquittoProvisioning, setMosquittoProvisioning] = useState(false)
  const [rfidWifiForm, setRfidWifiForm] = useState({
    ssid: '',
    password: ''
  })
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [restoreApplying, setRestoreApplying] = useState(false)
  const [restoreFileName, setRestoreFileName] = useState('')
  const [restorePayload, setRestorePayload] = useState(null)
  const [restorePreview, setRestorePreview] = useState(null)
  const [restoreIncludeTables, setRestoreIncludeTables] = useState('')
  const [platformDomains, setPlatformDomains] = useState(null)
  const [platformLoading, setPlatformLoading] = useState(false)
  const [platformSaving, setPlatformSaving] = useState(false)
  const [tenantDomainSaving, setTenantDomainSaving] = useState(false)
  const [domainActionLoadingById, setDomainActionLoadingById] = useState({})
  const [adminDomainForm, setAdminDomainForm] = useState({
    host: '',
    isPrimary: false,
    notes: ''
  })
  const [tenantDomainForm, setTenantDomainForm] = useState({
    host: '',
    isPrimary: false,
    notes: ''
  })

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

  const loadPlatformDomains = async (options = {}) => {
    const silent = Boolean(options?.silent)
    if (!silent) {
      setPlatformLoading(true)
    }

    try {
      const { data, error } = await supabase.super.domains()
      if (error) throw error
      setPlatformDomains(data || null)
    } catch (err) {
      if (!silent) {
        pushToast('error', err?.message || 'Gagal memuat konfigurasi domain platform')
      }
    } finally {
      if (!silent) {
        setPlatformLoading(false)
      }
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
      if (!silent || options?.syncMqttForm) {
        setMqttForm(mqttFormFromConfig(data?.rfid_mqtt_config))
      }
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
    loadPlatformDomains()
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

  const resetAdminDomainForm = () => {
    setAdminDomainForm({
      host: '',
      isPrimary: false,
      notes: ''
    })
  }

  const resetTenantDomainForm = () => {
    setTenantDomainForm({
      host: '',
      isPrimary: false,
      notes: ''
    })
  }

  const handleAdminDomainField = (field) => (event) => {
    const value = field === 'isPrimary' ? event.target.checked : event.target.value
    setAdminDomainForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleTenantDomainField = (field) => (event) => {
    const value = field === 'isPrimary' ? event.target.checked : event.target.value
    setTenantDomainForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleMqttField = (field) => (event) => {
    const checkboxFields = [
      'enabled',
      'clearPassword',
      'useTls',
      'tlsVerifyPeer',
      'tlsVerifyPeerName',
      'tlsAllowSelfSigned'
    ]
    const value = checkboxFields.includes(field) ? event.target.checked : event.target.value
    setMqttForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleMqttPreset = (preset) => {
    if (!preset?.values) return
    setMqttForm((prev) =>
      withStandardMqttTopics({
        ...prev,
        ...preset.values,
        clearPassword: false
      })
    )
    pushToast('success', `Preset ${preset.label} diterapkan`)
  }

  const handleRfidWifiField = (field) => (event) => {
    const value = event.target.value
    setRfidWifiForm((prev) => ({ ...prev, [field]: value }))
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
    resetTenantDomainForm()
    setMqttForm(RFID_MQTT_FORM_DEFAULTS)
    setRfidWifiForm({ ssid: '', password: '' })
    setRestorePreview(null)
    setRestorePayload(null)
    setRestoreFileName('')
    setRestoreIncludeTables('')
    await loadTenantDetail(tenantId)
  }

  const handleRefreshDetail = async () => {
    if (!selectedTenantId) return
    await loadTenantDetail(selectedTenantId, { silent: true, syncMqttForm: true })
  }

  const handleCreateAdminDomain = async (event) => {
    event.preventDefault()
    if (platformSaving) return

    const host = adminDomainForm.host.trim()
    if (!host) {
      pushToast('error', 'Host domain admin wajib diisi')
      return
    }

    setPlatformSaving(true)
    try {
      const payload = {
        host,
        is_primary: Boolean(adminDomainForm.isPrimary),
        notes: adminDomainForm.notes.trim() || undefined
      }
      const { error } = await supabase.super.createAdminDomain(payload)
      if (error) throw error

      pushToast('success', 'Domain admin berhasil didaftarkan')
      resetAdminDomainForm()
      await loadPlatformDomains({ silent: true })
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menambahkan domain admin')
    } finally {
      setPlatformSaving(false)
    }
  }

  const handleCreateTenantDomain = async (event) => {
    event.preventDefault()
    if (tenantDomainSaving) return

    const tenantId = tenantDetail?.tenant?.id || selectedTenantId
    const host = tenantDomainForm.host.trim()

    if (!tenantId) {
      pushToast('error', 'Pilih tenant terlebih dahulu')
      return
    }
    if (!host) {
      pushToast('error', 'Host domain tenant wajib diisi')
      return
    }

    setTenantDomainSaving(true)
    try {
      const payload = {
        host,
        is_primary: Boolean(tenantDomainForm.isPrimary),
        notes: tenantDomainForm.notes.trim() || undefined
      }
      const { error } = await supabase.super.createTenantDomain(tenantId, payload)
      if (error) throw error

      pushToast('success', 'Domain tenant berhasil didaftarkan')
      resetTenantDomainForm()
      await loadTenantDetail(tenantId, { silent: true, suppressToast: true })
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menambahkan domain tenant')
    } finally {
      setTenantDomainSaving(false)
    }
  }

  const handleSaveRfidMqtt = async (event) => {
    event.preventDefault()
    if (mqttSaving) return

    const tenantId = tenantDetail?.tenant?.id || selectedTenantId
    const host = mqttForm.host.trim()
    if (!tenantId) {
      pushToast('error', 'Pilih tenant terlebih dahulu')
      return
    }
    if (!host) {
      pushToast('error', 'Host MQTT wajib diisi')
      return
    }

    const password = mqttForm.password.trim()
    const payload = {
      enabled: Boolean(mqttForm.enabled),
      host,
      port: Number(mqttForm.port || 8883),
      username: mqttForm.username.trim() || undefined,
      use_tls: Boolean(mqttForm.useTls),
      tls_verify_peer: Boolean(mqttForm.tlsVerifyPeer),
      tls_verify_peer_name: Boolean(mqttForm.tlsVerifyPeerName),
      tls_allow_self_signed: Boolean(mqttForm.tlsAllowSelfSigned),
      qos: Number(mqttForm.qos || 1),
      client_id_prefix: mqttForm.clientIdPrefix.trim() || RFID_MQTT_FORM_DEFAULTS.clientIdPrefix,
      scan_topic_template: STANDARD_RFID_MQTT_TOPICS.scan,
      response_topic_template: STANDARD_RFID_MQTT_TOPICS.response,
      mode_topic_template: STANDARD_RFID_MQTT_TOPICS.mode,
      connect_timeout: Number(mqttForm.connectTimeout || 20),
      socket_timeout: Number(mqttForm.socketTimeout || 5),
      keep_alive: Number(mqttForm.keepAlive || 20)
    }

    if (password) {
      payload.password = password
    } else if (mqttForm.clearPassword) {
      payload.clear_password = true
    }

    setMqttSaving(true)
    try {
      const { data, error } = await supabase.super.updateTenantRfidMqtt(tenantId, payload)
      if (error) throw error

      setTenantDetail((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          rfid_mqtt_config: data?.rfid_mqtt_config || prev.rfid_mqtt_config,
          rfid_template: data?.rfid_template || prev.rfid_template
        }
      })
      setMqttForm(mqttFormFromConfig(data?.rfid_mqtt_config))
      pushToast('success', 'Konfigurasi MQTT RFID sekolah berhasil disimpan')
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menyimpan konfigurasi MQTT RFID')
    } finally {
      setMqttSaving(false)
    }
  }

  const handleProvisionMosquitto = async (rotatePassword = false) => {
    const tenantId = tenantDetail?.tenant?.id || selectedTenantId
    if (!tenantId || mosquittoProvisioning) return

    if (rotatePassword) {
      const confirmed = window.confirm(
        'Rotasi password MQTT Mosquitto sekolah ini? Device lama harus di-flash ulang dengan template terbaru.'
      )
      if (!confirmed) return
    }

    setMosquittoProvisioning(true)
    try {
      const { data, error } = await supabase.super.provisionTenantRfidMosquitto(tenantId, {
        rotate_password: Boolean(rotatePassword)
      })
      if (error) throw error

      setTenantDetail((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          rfid_mqtt_config: data?.rfid_mqtt_config || prev.rfid_mqtt_config,
          rfid_template: data?.rfid_template || prev.rfid_template
        }
      })
      setMqttForm(mqttFormFromConfig(data?.rfid_mqtt_config))
      pushToast(
        'success',
        rotatePassword
          ? 'Credential Mosquitto sekolah berhasil dirotasi'
          : 'Credential Mosquitto sekolah berhasil dibuat'
      )
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menyiapkan Mosquitto sekolah')
    } finally {
      setMosquittoProvisioning(false)
    }
  }

  const setDomainActionLoading = (domainId, value) => {
    setDomainActionLoadingById((prev) => {
      const next = { ...prev }
      if (value) {
        next[domainId] = true
      } else {
        delete next[domainId]
      }
      return next
    })
  }

  const handleCheckDomain = async (domain) => {
    const domainId = String(domain?.id || '')
    if (!domainId || domainActionLoadingById[domainId]) return

    setDomainActionLoading(domainId, true)
    try {
      const { error } = await supabase.super.checkDomain(domainId)
      if (error) throw error

      pushToast('success', `Verifikasi DNS untuk ${domain.host} selesai`)
      if (domain?.domain_type === 'admin') {
        await loadPlatformDomains({ silent: true })
      } else if (domain?.tenant_id) {
        await loadTenantDetail(domain.tenant_id, { silent: true, suppressToast: true })
      }
    } catch (err) {
      pushToast('error', err?.message || 'Gagal mengecek domain')
    } finally {
      setDomainActionLoading(domainId, false)
    }
  }

  const handleDeleteDomain = async (domain) => {
    const domainId = String(domain?.id || '')
    if (!domainId || domainActionLoadingById[domainId]) return

    const confirmed = window.confirm(
      `Hapus domain ${domain?.host || domainId}? Host ini akan langsung berhenti dipakai aplikasi.`
    )
    if (!confirmed) return

    setDomainActionLoading(domainId, true)
    try {
      const { error } = await supabase.super.deleteDomain(domainId)
      if (error) throw error

      pushToast('success', `Domain ${domain?.host || domainId} dihapus`)
      if (domain?.domain_type === 'admin') {
        await loadPlatformDomains({ silent: true })
      } else if (domain?.tenant_id) {
        await loadTenantDetail(domain.tenant_id, { silent: true, suppressToast: true })
      }
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menghapus domain')
    } finally {
      setDomainActionLoading(domainId, false)
    }
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

  const detailRfidTemplate = tenantDetail?.rfid_template || null
  const detailRfidMqttConfig = tenantDetail?.rfid_mqtt_config || {}
  const detailTenantSlug = tenantDetail?.tenant?.slug || detailRfidTemplate?.tenant_slug || ''
  const mqttTopicPreview = useMemo(
    () => [
      {
        key: 'scan',
        label: 'Scan',
        template: STANDARD_RFID_MQTT_TOPICS.scan,
        preview: renderMqttTopicTemplate(STANDARD_RFID_MQTT_TOPICS.scan, detailTenantSlug)
      },
      {
        key: 'response',
        label: 'Response',
        template: STANDARD_RFID_MQTT_TOPICS.response,
        preview: renderMqttTopicTemplate(STANDARD_RFID_MQTT_TOPICS.response, detailTenantSlug)
      },
      {
        key: 'mode',
        label: 'Mode',
        template: STANDARD_RFID_MQTT_TOPICS.mode,
        preview: renderMqttTopicTemplate(STANDARD_RFID_MQTT_TOPICS.mode, detailTenantSlug)
      }
    ],
    [detailTenantSlug]
  )
  const rfidArduinoCode = useMemo(
    () => buildTenantRfidArduinoCode(detailRfidTemplate, rfidWifiForm),
    [detailRfidTemplate, rfidWifiForm]
  )
  const rfidWifiReady = rfidWifiForm.ssid.trim() !== '' && rfidWifiForm.password.trim() !== ''

  const handleCopyRfidArduinoCode = async () => {
    if (!rfidArduinoCode) {
      pushToast('error', 'Template Arduino RFID belum tersedia')
      return
    }

    try {
      const copied = await copyText(rfidArduinoCode)
      if (!copied) throw new Error('Clipboard tidak tersedia')
      pushToast('success', 'Kode Arduino RFID siap flash berhasil dicopy')
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menyalin kode Arduino RFID')
    }
  }

  const handleCopyRfidSecret = async () => {
    const secret = detailRfidTemplate?.device_secret || ''
    if (!secret) {
      pushToast('error', 'Secret RFID belum tersedia')
      return
    }

    try {
      const copied = await copyText(secret)
      if (!copied) throw new Error('Clipboard tidak tersedia')
      pushToast('success', 'Secret RFID berhasil dicopy')
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menyalin secret RFID')
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
  const detailAccess = tenantDetail?.access || {}
  const detailStats = tenantDetail?.stats || {}
  const detailAdmins = Array.isArray(tenantDetail?.admins) ? tenantDetail.admins : []
  const detailDomains = Array.isArray(tenantDetail?.domains) ? tenantDetail.domains : []
  const detailStorage = tenantDetail?.storage || {}
  const detailGoogleDrive = tenantDetail?.google_drive || {}
  const storageBuckets = Array.isArray(detailStorage?.buckets) ? detailStorage.buckets : []
  const detailRfidNotes = Array.isArray(detailRfidTemplate?.notes) ? detailRfidTemplate.notes : []
  const primaryAdminUserId = String(detailTenant?.primary_admin_user_id || '')
  const primaryAdminInfo = detailAdmins.find(
    (admin) => String(admin?.user_id || '') === primaryAdminUserId
  )
  const platformOverview = platformDomains?.platform || {}
  const platformDnsRecords = Array.isArray(platformOverview?.dns_records)
    ? platformOverview.dns_records
    : []
  const platformNotes = Array.isArray(platformOverview?.notes) ? platformOverview.notes : []
  const adminDomains = Array.isArray(platformDomains?.admin_domains) ? platformDomains.admin_domains : []
  const isLocalRootDomain = ['localhost', '127.0.0.1'].includes(String(rootDomain || '').trim().toLowerCase())
  const sampleTenantSlug = 'smabali'
  const builtinTenantExample = rootDomain ? `${sampleTenantSlug}.${rootDomain}` : `${sampleTenantSlug}.example.com`
  const customTenantExample = isLocalRootDomain ? 'smabali.localhost' : 'portal.smabali.sch.id'
  const adminHostExample =
    platformOverview.default_admin_host || (rootDomain ? `admin.${rootDomain}` : 'admin.example.com')
  const onboardingSteps = [
    'Saat sekolah baru berlangganan, buat tenant dulu dengan nama sekolah, slug unik, dan akun admin sekolah.',
    `Tenant langsung aktif di subdomain bawaan seperti ${builtinTenantExample}. Ini paling cepat untuk go-live.`,
    'Kalau sekolah ingin domain sendiri, buka detail tenant lalu tambahkan custom domain tenant di panel yang sama.',
    'Arahkan DNS domain sekolah ke target default platform, tunggu propagasi, lalu klik Cek DNS sampai status ready.'
  ]
  const onboardingModes = [
    {
      title: 'Mode Cepat',
      description: `Pakai subdomain bawaan seperti ${builtinTenantExample}. Cocok untuk onboarding cepat tanpa menunggu setting registrar.`
    },
    {
      title: 'Mode Branding',
      description: `Pakai domain sekolah sendiri seperti ${customTenantExample}. Dipakai setelah DNS sekolah diarahkan ke platform.`
    },
    {
      title: 'Panel Super Admin',
      description: `Host admin dipisah di ${adminHostExample} supaya akses tenant dan super admin tidak tercampur.`
    }
  ]
  const tenantSummary = tenants.reduce(
    (summary, tenant) => {
      const status = String(tenant?.status || '').toLowerCase()
      return {
        total: summary.total + 1,
        active: summary.active + (status === 'active' ? 1 : 0),
        suspended: summary.suspended + (status === 'suspended' ? 1 : 0),
        archived: summary.archived + (status === 'archived' ? 1 : 0),
        driveReady: summary.driveReady + (tenant?.google_drive?.ready ? 1 : 0)
      }
    },
    { total: 0, active: 0, suspended: 0, archived: 0, driveReady: 0 }
  )
  const selectedTenantRow = tenants.find((tenant) => tenant.id === selectedTenantId)
  const readyAdminDomains = adminDomains.filter((domain) => domain?.status === 'ready').length

  return (
    <div className="p-6 space-y-6">
      <div className="page-title-card">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-sm font-bold text-blue-700">
            TN
          </div>
          <div>
            <h1 className="page-title-heading">Panel Super Admin</h1>
            <p className="page-title-description">
              Buat sekolah baru, lihat ringkasan tenant, dan kelola admin sekolah.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500">Total Sekolah</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{numberFormatter.format(tenantSummary.total)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm">
          <p className="text-xs font-semibold text-emerald-700">Aktif</p>
          <p className="mt-2 text-2xl font-bold text-emerald-800">{numberFormatter.format(tenantSummary.active)}</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm">
          <p className="text-xs font-semibold text-amber-700">Suspended</p>
          <p className="mt-2 text-2xl font-bold text-amber-800">{numberFormatter.format(tenantSummary.suspended)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500">Drive Siap</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{numberFormatter.format(tenantSummary.driveReady)}</p>
        </div>
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 shadow-sm">
          <p className="text-xs font-semibold text-indigo-700">Host Admin Ready</p>
          <p className="mt-2 text-2xl font-bold text-indigo-800">{numberFormatter.format(readyAdminDomains)}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Daftar Sekolah</h2>
              <p className="mt-1 text-sm text-slate-600">
                Pilih sekolah untuk melihat admin, domain, storage, backup, dan konfigurasi perangkat.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedTenantId && (
                <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
                  Dipilih: {selectedTenantRow?.name || detailTenant?.name || 'Sekolah'}
                </span>
              )}
              <button
                type="button"
                onClick={loadTenants}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>
          </div>

          {loading ? (
            <div className="p-5 text-sm text-slate-500">Memuat data sekolah...</div>
          ) : tenants.length === 0 ? (
            <div className="p-5 text-sm text-slate-500">Belum ada sekolah.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3">Sekolah</th>
                    <th className="px-5 py-3">Subdomain</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Google Drive</th>
                    <th className="px-5 py-3">Dibuat</th>
                    <th className="px-5 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {tenants.map((tenant) => (
                    <tr
                      key={tenant.id}
                      className={`cursor-pointer transition hover:bg-slate-50 ${
                        selectedTenantId === tenant.id ? 'bg-indigo-50/80' : 'bg-white'
                      }`}
                      onClick={() => handleSelectTenant(tenant.id)}
                    >
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-900">{tenant.name || '-'}</p>
                        <p className="mt-1 text-xs text-slate-500">{tenant.id}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-medium text-slate-900">
                          {tenant.slug ? `${tenant.slug}.${rootDomain}` : '-'}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">Slug: {tenant.slug || '-'}</p>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tenantStatusBadgeClass(
                            tenant.status
                          )}`}
                        >
                          {tenant.status || 'unknown'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-1">
                          <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${driveStatusBadgeClass(tenant.google_drive)}`}>
                            {tenant.google_drive?.ready ? 'Siap' : tenant.google_drive?.status_label || 'Belum'}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {tenant.google_drive?.quota?.used_label || '0 B'}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-500">{formatDateTime(tenant.created_at)}</td>
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSelectTenant(tenant.id)
                          }}
                          className="rounded-full border border-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                        >
                          Kelola
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Buat Sekolah</h2>
              <p className="mt-1 text-sm text-slate-600">
                Buat tenant, subdomain bawaan, dan akun admin sekolah dalam satu langkah.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">Nama Sekolah</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={handleChange('name')}
                  placeholder="Contoh: SMA Negeri 1"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">Subdomain Sekolah</label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={handleChange('slug')}
                  placeholder="contoh: sma1"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-slate-500">
                  URL: <span className="font-semibold">{previewDomain || builtinTenantExample}</span>
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">Nama Admin</label>
                <input
                  type="text"
                  value={form.adminName}
                  onChange={handleChange('adminName')}
                  placeholder="Nama admin"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">Email Admin</label>
                <input
                  type="email"
                  value={form.adminEmail}
                  onChange={handleChange('adminEmail')}
                  placeholder="admin@sekolah.com"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">Password Admin</label>
                <PasswordInput
                  value={form.adminPassword}
                  onChange={handleChange('adminPassword')}
                  placeholder="Minimal 6 karakter"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {saving ? 'Menyimpan...' : 'Buat Sekolah'}
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-900 p-5 text-white shadow-sm">
            <h2 className="text-base font-semibold">Panduan Onboarding</h2>
            <div className="mt-4 space-y-3">
              {onboardingSteps.map((step, index) => (
                <div key={step} className="flex gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-slate-900">
                    {index + 1}
                  </span>
                  <p className="text-sm leading-6 text-slate-100">{step}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-2">
              {onboardingModes.map((item) => (
                <div key={item.title} className="rounded-xl bg-white/5 px-3 py-2">
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-300">{item.description}</p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Konfigurasi Platform & DNS</h2>
            <p className="mt-1 text-sm text-slate-600">
              Pantau host admin, target DNS, dan domain platform dari satu area operasional.
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadPlatformDomains()}
            disabled={platformLoading}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {platformLoading ? 'Memuat...' : 'Refresh Domain'}
          </button>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <p className="text-xs text-slate-500">Root Domain Tenant</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {platformOverview.root_domain || rootDomain || 'Belum diatur'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <p className="text-xs text-slate-500">Host Admin Default</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {platformOverview.default_admin_host || 'Belum diatur'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <p className="text-xs text-slate-500">Wildcard Tenant</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {platformOverview.wildcard_example || 'Belum diatur'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <p className="text-xs text-slate-500">WhatsApp / Evolution</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {platformOverview.evolution_host || 'Belum diatur'}
                </p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[0.95fr,1.05fr]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Target DNS Default</h3>
                  <span className="rounded-full border border-indigo-200 bg-indigo-100 px-2 py-1 text-[11px] text-indigo-700">
                    {platformOverview.manual_dns_mode ? 'Verifikasi manual' : 'Otomatis'}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {platformDnsRecords.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      Target DNS belum tersedia. Isi `TENANT_DNS_A_RECORD` atau `TENANT_DNS_CNAME_TARGET` di env production.
                    </p>
                  ) : (
                    platformDnsRecords.map((record, index) => (
                      <div
                        key={`${record.host}-${record.type}-${index}`}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                      >
                        <p className="text-xs text-slate-500">{record.label || 'Record'}</p>
                        <p className="mt-0.5 text-sm font-semibold text-slate-900">
                          {record.host} {record.type} {record.value}
                        </p>
                      </div>
                    ))
                  )}
                </div>
                {platformNotes.length > 0 && (
                  <div className="mt-3 grid gap-2 text-xs text-slate-500">
                    {platformNotes.map((note) => (
                      <div key={note} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                        {note}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Custom Host Super Admin</h3>
                  <span className="text-xs text-slate-500">{adminDomains.length} host tambahan</span>
                </div>

                {adminDomains.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">
                    Belum ada custom host admin. Host admin default dari env tetap aktif.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {adminDomains.map((domain) => {
                      const busy = Boolean(domainActionLoadingById[domain.id])
                      return (
                        <div key={domain.id} className="rounded-xl border border-slate-200 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-slate-900">{domain.host}</p>
                                {domain.is_primary && (
                                  <span className="rounded-full border border-indigo-200 bg-indigo-100 px-2 py-0.5 text-[11px] text-indigo-700">
                                    Primary
                                  </span>
                                )}
                                <span className={`rounded-full px-2 py-0.5 text-[11px] ${domainStatusBadgeClass(domain.status)}`}>
                                  {domain.status || 'pending'}
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-[11px] ${dnsStatusBadgeClass(domain.last_dns_status)}`}>
                                  DNS {domain.last_dns_status || 'belum dicek'}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">{domain.url}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleCheckDomain(domain)}
                                disabled={busy}
                                className="rounded-full border border-emerald-200 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                              >
                                {busy ? 'Cek...' : 'Cek DNS'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteDomain(domain)}
                                disabled={busy}
                                className="rounded-full border border-rose-200 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                              >
                                Hapus
                              </button>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                            <div className="rounded-lg bg-slate-50 px-3 py-2">
                              <p className="text-slate-500">Expected DNS</p>
                              <p className="mt-1 text-slate-800">{formatDnsRecords(domain.expected_records)}</p>
                            </div>
                            <div className="rounded-lg bg-slate-50 px-3 py-2">
                              <p className="text-slate-500">Observed DNS</p>
                              <p className="mt-1 text-slate-800">{formatDnsRecords(domain.observed_records)}</p>
                            </div>
                          </div>
                          {domain.last_dns_error && (
                            <p className="mt-2 text-xs text-rose-600">{domain.last_dns_error}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Referensi Cepat</h3>
              <div className="mt-3 space-y-2 text-sm">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <p className="text-xs font-semibold text-emerald-700">Tenant cepat</p>
                  <p className="mt-1 text-slate-700">{builtinTenantExample}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <p className="text-xs font-semibold text-blue-700">Domain sekolah</p>
                  <p className="mt-1 text-slate-700">{customTenantExample}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <p className="text-xs font-semibold text-amber-700">Panel admin</p>
                  <p className="mt-1 text-slate-700">{adminHostExample}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Tambah Host Admin</h3>
              <p className="mt-1 text-xs text-slate-500">
                Cocok untuk domain seperti `panel.sekolahkamu.com` atau `admin.grupkamu.id`.
              </p>
              <form onSubmit={handleCreateAdminDomain} className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">Host</label>
                  <input
                    type="text"
                    value={adminDomainForm.host}
                    onChange={handleAdminDomainField('host')}
                    placeholder="panel.sekolahkamu.com"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">Catatan</label>
                  <textarea
                    value={adminDomainForm.notes}
                    onChange={handleAdminDomainField('notes')}
                    rows={3}
                    placeholder="Opsional: catatan penggunaan host ini"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={adminDomainForm.isPrimary}
                    onChange={handleAdminDomainField('isPrimary')}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Jadikan host admin utama
                </label>
                <button
                  type="submit"
                  disabled={platformSaving}
                  className="w-full rounded-lg bg-slate-900 px-4 py-2.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {platformSaving ? 'Menyimpan...' : 'Simpan Host Admin'}
                </button>
              </form>
            </div>
          </aside>
        </div>
      </section>

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
                  resetTenantDomainForm()
                  setMqttForm(RFID_MQTT_FORM_DEFAULTS)
                  setRfidWifiForm({ ssid: '', password: '' })
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

              <form onSubmit={handleSaveRfidMqtt} className="rounded-2xl border border-slate-200 p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Konfigurasi MQTT RFID Sekolah</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Setting ini dipakai bridge backend dan otomatis masuk ke template ESP sekolah ini.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] px-2 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                      {detailRfidMqttConfig?.managed_by_platform
                        ? 'Mosquitto platform'
                        : detailRfidMqttConfig?.source === 'tenant'
                          ? 'Config tenant'
                          : 'Fallback global'}
                    </span>
                    <span
                      className={`text-[11px] px-2 py-1 rounded-full border ${
                        detailRfidMqttConfig?.available
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}
                    >
                      {detailRfidMqttConfig?.available ? 'Aktif' : 'Belum aktif'}
                    </span>
                    {detailRfidMqttConfig?.password_set && (
                      <span className="text-[11px] px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                        Password tersimpan
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleProvisionMosquitto(false)}
                      disabled={mosquittoProvisioning}
                      className="text-xs px-3 py-1.5 rounded-full border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                    >
                      {mosquittoProvisioning ? 'Menyiapkan...' : 'Pakai Mosquitto'}
                    </button>
                    {detailRfidMqttConfig?.managed_by_platform && (
                      <button
                        type="button"
                        onClick={() => handleProvisionMosquitto(true)}
                        disabled={mosquittoProvisioning}
                        className="text-xs px-3 py-1.5 rounded-full border border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                      >
                        Rotasi Password
                      </button>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold text-slate-700">Preset Broker</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Pilih preset, lalu isi host, username, dan password broker.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {MQTT_BROKER_PRESETS.map((preset) => (
                        <button
                          key={preset.key}
                          type="button"
                          onClick={() => handleMqttPreset(preset)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs hover:border-indigo-200 hover:bg-indigo-50"
                        >
                          <span className="block font-semibold text-slate-900">{preset.label}</span>
                          <span className="block text-slate-500 mt-0.5">{preset.helper}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-slate-700">Host MQTT</span>
                    <input
                      type="text"
                      value={mqttForm.host}
                      onChange={handleMqttField('host')}
                      placeholder="mqtt.sekolah.sch.id"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-slate-700">Port</span>
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      value={mqttForm.port}
                      onChange={handleMqttField('port')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-slate-700">Username</span>
                    <input
                      type="text"
                      value={mqttForm.username}
                      onChange={handleMqttField('username')}
                      placeholder="username MQTT"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-slate-700">Password MQTT</span>
                    <PasswordInput
                      value={mqttForm.password}
                      onChange={handleMqttField('password')}
                      placeholder={detailRfidMqttConfig?.password_set ? 'Kosongkan bila tetap' : 'Password MQTT'}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </label>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-700">Topic RFID Standar</p>
                      <p className="text-xs text-slate-500 mt-1">Dipakai otomatis oleh backend dan kode Arduino.</p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                      Template terkunci
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
                    {mqttTopicPreview.map((topic) => (
                      <div key={topic.key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase text-slate-500">{topic.label}</div>
                        <div className="mt-1 break-all text-sm font-semibold text-slate-900">{topic.preview}</div>
                        <div className="mt-1 break-all text-[11px] text-slate-500">{topic.template}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-slate-700">QoS</span>
                    <select
                      value={mqttForm.qos}
                      onChange={handleMqttField('qos')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="0">0</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-slate-700">Client Prefix</span>
                    <input
                      type="text"
                      value={mqttForm.clientIdPrefix}
                      onChange={handleMqttField('clientIdPrefix')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-slate-700">Connect Timeout</span>
                    <input
                      type="number"
                      min="3"
                      max="120"
                      value={mqttForm.connectTimeout}
                      onChange={handleMqttField('connectTimeout')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-slate-700">Socket Timeout</span>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={mqttForm.socketTimeout}
                      onChange={handleMqttField('socketTimeout')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-slate-700">Keep Alive</span>
                    <input
                      type="number"
                      min="3"
                      max="300"
                      value={mqttForm.keepAlive}
                      onChange={handleMqttField('keepAlive')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={mqttForm.enabled}
                        onChange={handleMqttField('enabled')}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      Aktif
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={mqttForm.useTls}
                        onChange={handleMqttField('useTls')}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      TLS
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={mqttForm.tlsVerifyPeer}
                        onChange={handleMqttField('tlsVerifyPeer')}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      Verify peer
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={mqttForm.tlsVerifyPeerName}
                        onChange={handleMqttField('tlsVerifyPeerName')}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      Verify name
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={mqttForm.tlsAllowSelfSigned}
                        onChange={handleMqttField('tlsAllowSelfSigned')}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      Self-signed
                    </label>
                    {detailRfidMqttConfig?.password_set && (
                      <label className="inline-flex items-center gap-2 text-rose-600">
                        <input
                          type="checkbox"
                          checked={mqttForm.clearPassword}
                          onChange={handleMqttField('clearPassword')}
                          className="rounded border-rose-300 text-rose-600 focus:ring-rose-500"
                        />
                        Hapus password tersimpan
                      </label>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={mqttSaving}
                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {mqttSaving ? 'Menyimpan...' : 'Simpan MQTT RFID'}
                  </button>
                </div>
              </form>

              <div className="rounded-2xl border border-slate-200 p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Template Arduino RFID</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Template ini otomatis diisi khusus untuk sekolah ini. Device cukup kirim scan lewat MQTT,
                      lalu backend yang menentukan mode masuk/pulang, jadwal aktif, dan enroll UID.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyRfidSecret}
                      disabled={!detailRfidTemplate?.available}
                      className="text-xs px-3 py-1.5 rounded-full border border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                    >
                      Salin Secret
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyRfidArduinoCode}
                      disabled={!rfidArduinoCode}
                      className="text-xs px-3 py-1.5 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
                    >
                      Salin Code Siap Flash
                    </button>
                  </div>
                </div>

                {!detailRfidTemplate?.available ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {detailRfidTemplate?.message || 'Template RFID belum tersedia untuk tenant ini.'}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-xs text-slate-500">Tenant Slug</p>
                        <p className="text-sm font-semibold text-slate-900 mt-1">
                          {detailRfidTemplate.tenant_slug || '-'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-xs text-slate-500">Device ID Default</p>
                        <p className="text-sm font-semibold text-slate-900 mt-1 break-all">
                          {detailRfidTemplate.device_id || '-'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-xs text-slate-500">Firmware</p>
                        <p className="text-sm font-semibold text-slate-900 mt-1 break-all">
                          {detailRfidTemplate.firmware_version || '-'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-xs text-slate-500">MQTT Host</p>
                        <p className="text-sm font-semibold text-slate-900 mt-1 break-all">
                          {detailRfidTemplate?.mqtt?.host || '-'}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-slate-700">WiFi Alat</p>
                          <p className="text-xs text-slate-500 mt-1">Lokal di browser, tidak disimpan ke server.</p>
                        </div>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                            rfidWifiReady
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-amber-200 bg-amber-50 text-amber-700'
                          }`}
                        >
                          {rfidWifiReady ? 'WiFi terisi' : 'WiFi placeholder'}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="space-y-1">
                          <span className="text-xs font-semibold text-slate-700">WiFi SSID</span>
                          <input
                            type="text"
                            value={rfidWifiForm.ssid}
                            onChange={handleRfidWifiField('ssid')}
                            placeholder="Nama WiFi lokasi alat"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold text-slate-700">Password WiFi</span>
                          <PasswordInput
                            value={rfidWifiForm.password}
                            onChange={handleRfidWifiField('password')}
                            placeholder="Password WiFi lokasi alat"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-[0.95fr,1.35fr] gap-4">
                      <div className="space-y-3">
                        <div className="rounded-xl border border-slate-200 p-4">
                          <p className="text-xs font-semibold text-slate-700">Topic MQTT</p>
                          <div className="mt-3 space-y-2 text-xs">
                            <div className="rounded-lg bg-slate-50 px-3 py-2">
                              <div className="text-slate-500">Scan</div>
                              <div className="font-semibold text-slate-900 break-all">
                                {detailRfidTemplate?.topics?.scan || '-'}
                              </div>
                            </div>
                            <div className="rounded-lg bg-slate-50 px-3 py-2">
                              <div className="text-slate-500">Response</div>
                              <div className="font-semibold text-slate-900 break-all">
                                {detailRfidTemplate?.topics?.response || '-'}
                              </div>
                            </div>
                            <div className="rounded-lg bg-slate-50 px-3 py-2">
                              <div className="text-slate-500">Mode</div>
                              <div className="font-semibold text-slate-900 break-all">
                                {detailRfidTemplate?.topics?.mode || '-'}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 space-y-2">
                          <p className="text-xs font-semibold text-amber-800">Catatan penting</p>
                          {detailRfidNotes.map((note) => (
                            <p key={note} className="text-xs text-amber-700">
                              - {note}
                            </p>
                          ))}
                          <p className="text-xs text-amber-700">
                            {rfidWifiReady
                              ? 'WiFi sudah masuk ke kode Arduino yang akan disalin.'
                              : 'Kolom WiFi kosong akan memakai placeholder di kode Arduino.'}
                          </p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 overflow-hidden">
                        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Code Arduino Siap Copy</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {rfidWifiReady
                                ? `Template sudah terisi untuk sekolah ${detailTenant?.name || '-'}.`
                                : 'WiFi masih memakai placeholder.'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleCopyRfidArduinoCode}
                            disabled={!rfidArduinoCode}
                            className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                          >
                            Salin
                          </button>
                        </div>
                        <pre className="max-h-[34rem] overflow-auto bg-slate-950 text-slate-100 text-[11px] leading-5 p-4 whitespace-pre">
                          {rfidArduinoCode}
                        </pre>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Domain & DNS Tenant</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Subdomain bawaan tetap aktif, dan tenant bisa ditambah custom domain sendiri dari panel ini.
                    </p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                    {detailDomains.length} custom domain
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[1.25fr,0.95fr] gap-4">
                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                      <p className="text-xs text-slate-500">URL bawaan tenant</p>
                      <p className="text-sm font-semibold text-slate-900 mt-1">
                        {detailAccess.default_url || '-'}
                      </p>
                      <p className="text-xs text-slate-500 mt-2">
                        Host default: {detailAccess.default_host || '-'}
                      </p>
                    </div>

                    {detailDomains.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                        Belum ada custom domain tenant. Tenant tetap bisa diakses dari subdomain bawaan.
                      </div>
                    ) : (
                      detailDomains.map((domain) => {
                        const busy = Boolean(domainActionLoadingById[domain.id])
                        return (
                          <div key={domain.id} className="rounded-xl border border-slate-200 p-4 space-y-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-slate-900">{domain.host}</p>
                                  {domain.is_primary && (
                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200">
                                      Primary
                                    </span>
                                  )}
                                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${domainStatusBadgeClass(domain.status)}`}>
                                    {domain.status || 'pending'}
                                  </span>
                                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${dnsStatusBadgeClass(domain.last_dns_status)}`}>
                                    DNS {domain.last_dns_status || 'belum dicek'}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-500 mt-1">{domain.url}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleCheckDomain(domain)}
                                  disabled={busy}
                                  className="text-xs px-3 py-1.5 rounded-full border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                                >
                                  {busy ? 'Cek...' : 'Cek DNS'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDomain(domain)}
                                  disabled={busy}
                                  className="text-xs px-3 py-1.5 rounded-full border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                                >
                                  Hapus
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                              <div className="rounded-lg bg-slate-50 px-3 py-2">
                                <p className="text-slate-500">Expected DNS</p>
                                <p className="text-slate-800 mt-1">{formatDnsRecords(domain.expected_records)}</p>
                              </div>
                              <div className="rounded-lg bg-slate-50 px-3 py-2">
                                <p className="text-slate-500">Observed DNS</p>
                                <p className="text-slate-800 mt-1">{formatDnsRecords(domain.observed_records)}</p>
                              </div>
                            </div>
                            {domain.notes && (
                              <p className="text-xs text-slate-500">Catatan: {domain.notes}</p>
                            )}
                            {domain.last_dns_error && (
                              <p className="text-xs text-rose-600">{domain.last_dns_error}</p>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <h4 className="text-sm font-semibold text-slate-900">Tambah Custom Domain Tenant</h4>
                    <p className="text-xs text-slate-500 mt-1">
                      Gunakan domain luar seperti `smabali.sch.id` atau `portal.sekolah-bali.com`.
                    </p>
                    <form onSubmit={handleCreateTenantDomain} className="mt-4 space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-600">Host</label>
                        <input
                          type="text"
                          value={tenantDomainForm.host}
                          onChange={handleTenantDomainField('host')}
                          placeholder="smabali.sch.id"
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-600">Catatan</label>
                        <textarea
                          value={tenantDomainForm.notes}
                          onChange={handleTenantDomainField('notes')}
                          rows={3}
                          placeholder="Opsional: domain utama sekolah, portal publik, dll."
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={tenantDomainForm.isPrimary}
                          onChange={handleTenantDomainField('isPrimary')}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        Jadikan domain utama tenant
                      </label>
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                        Setelah disimpan, arahkan DNS domain ke target platform lalu klik <strong>Cek DNS</strong>.
                      </div>
                      <button
                        type="submit"
                        disabled={tenantDomainSaving}
                        className="w-full px-4 py-2.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-60"
                      >
                        {tenantDomainSaving ? 'Menyimpan...' : 'Simpan Custom Domain'}
                      </button>
                    </form>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Google Drive Sekolah</h3>
                  <span className={`text-xs px-2 py-1 rounded-full ${driveStatusBadgeClass(detailGoogleDrive)}`}>
                    {detailGoogleDrive?.status_label || 'Belum tersambung'}
                  </span>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-emerald-200 bg-white p-3">
                    <p className="text-xs text-slate-500">Status</p>
                    <p className="text-sm font-bold text-slate-900 mt-1">
                      {detailGoogleDrive?.ready ? 'Siap dipakai' : detailGoogleDrive?.status_label || '-'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-white p-3">
                    <p className="text-xs text-slate-500">Storage Saat Ini</p>
                    <p className="text-lg font-bold text-slate-900 mt-1">
                      {detailGoogleDrive?.quota?.used_label || '0 B'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-white p-3">
                    <p className="text-xs text-slate-500">Upload Hari Ini</p>
                    <p className="text-lg font-bold text-slate-900 mt-1">
                      {detailGoogleDrive?.today?.uploaded_label || '0 B'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-white p-3">
                    <p className="text-xs text-slate-500">File EduSmart</p>
                    <p className="text-lg font-bold text-slate-900 mt-1">
                      {numberFormatter.format(toNumber(detailGoogleDrive?.app_storage?.files))}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs">
                  <div className="rounded-xl border border-emerald-200 bg-white p-3 lg:col-span-2">
                    <p className="font-semibold text-slate-500">Akun</p>
                    <p className="mt-1 break-all text-sm font-semibold text-slate-900">
                      {detailGoogleDrive?.account_email || '-'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-white p-3">
                    <p className="font-semibold text-slate-500">Limit</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {detailGoogleDrive?.quota?.limit_label || 'Tidak terbatas'}
                    </p>
                  </div>
                </div>

                {detailGoogleDrive?.last_error && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    {detailGoogleDrive.last_error}
                  </div>
                )}
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
