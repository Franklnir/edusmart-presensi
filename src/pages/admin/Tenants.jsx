import React, { useEffect, useMemo, useState } from 'react'
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  Copy,
  Database,
  Filter,
  Globe2,
  HardDrive,
  Loader2,
  PlusCircle,
  Radio,
  RefreshCw,
  Router,
  School,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserCog,
  X,
  XCircle
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'
import PasswordInput from '../../components/PasswordInput'
import { loadExcelJsBrowser } from '../../utils/excelBrowser'
import { validatePassword } from '../../utils/passwordPolicy'
import { buildRestoreStatusToast } from '../../utils/restoreStatus'
import rfidArduinoTemplateSource from '../../../docs/esp8266-rfid-mosquitto-tenant.ino?raw'

const ADMIN_SUBDOMAIN = String(import.meta.env.VITE_ADMIN_SUBDOMAIN || 'admin26')
  .trim()
  .toLowerCase()
const RESERVED_TENANT_SLUGS = new Set(['www', 'app', 'api', 'admin', ADMIN_SUBDOMAIN].filter(Boolean))

const slugify = (value = '') =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)

const isValidTenantSlug = (value = '') => {
  const slug = String(value || '').trim()
  return /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(slug) && !slug.includes('--')
}

const isReservedTenantSlug = (value = '') => RESERVED_TENANT_SLUGS.has(String(value || '').trim().toLowerCase())

const isValidEmail = (value = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())

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

const TENANT_DETAIL_TABS = [
  { value: 'overview', label: 'Ringkasan', icon: School },
  { value: 'admins', label: 'Admin', icon: UserCog },
  { value: 'domains', label: 'Domain', icon: Globe2 },
  { value: 'backup', label: 'Backup & Restore', icon: Database },
  { value: 'devices', label: 'RFID & MQTT', icon: ShieldCheck }
]

const STANDARD_RFID_MQTT_TOPICS = {
  scan: 'edusmart/{tenant}/rfid/{device}/scan',
  response: 'edusmart/{tenant}/rfid/{device}/response',
  mode: 'edusmart/{tenant}/rfid/{device}/mode'
}

const RFID_BOARD_OPTIONS = [
  { value: 'esp8266', label: 'ESP8266' },
  { value: 'esp32', label: 'ESP32' }
]

const renderMqttTopicTemplate = (template, tenantSlug = '', deviceId = '{device}') => {
  const slug = String(tenantSlug || '').trim() || '{tenant}'
  const device = String(deviceId || '').trim() || '{device}'
  return String(template || '').replaceAll('{tenant}', slug).replaceAll('{device}', device)
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

const buildRfidArduinoTemplateSource = (boardType = 'esp8266') => {
  if (String(boardType || '').toLowerCase() !== 'esp32') {
    return rfidArduinoTemplateSource
  }

  return rfidArduinoTemplateSource
    .replace('ESP8266 + PN532 + Mosquitto MQTT-only RFID', 'ESP32 + PN532 + Mosquitto MQTT-only RFID')
    .replace('ESP8266 hanya membaca kartu dan publish event scan ke MQTT.', 'ESP32 hanya membaca kartu dan publish event scan ke MQTT.')
    .replace('- ESP8266 Board Package', '- ESP32 Board Package')
    .replace('#include <ESP8266WiFi.h>\n#include <WiFiClientSecureBearSSL.h>', '#include <WiFi.h>\n#include <WiFiClientSecure.h>')
    .replace('#define PN532_SCK   D5', '#define PN532_SCK   18')
    .replace('#define PN532_MISO  D6', '#define PN532_MISO  19')
    .replace('#define PN532_MOSI  D7', '#define PN532_MOSI  23')
    .replace('#define PN532_SS    D0', '#define PN532_SS    5')
    .replace('#define LED_PIN      LED_BUILTIN', '#define LED_PIN      2')
    .replace('#define BUZZER_PIN   D2', '#define BUZZER_PIN   4')
    .replace('BearSSL::WiFiClientSecure mqttSecureClient;', 'WiFiClientSecure mqttSecureClient;')
}

const buildTenantRfidArduinoCode = (template, wifi = {}) => {
  if (!template?.available) return ''
  if (!template?.mqtt?.host || !template?.mqtt?.username || !template?.mqtt?.password) return ''

  let source = buildRfidArduinoTemplateSource(template?.board_type || 'esp8266')
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

const summarizeBackupPayload = (payload) => {
  const tables = Array.isArray(payload?.tables) ? payload.tables : []
  const totalRows = tables.reduce((sum, table) => {
    const rowCount = Number(table?.row_count)
    if (Number.isFinite(rowCount)) return sum + rowCount
    return sum + (Array.isArray(table?.rows) ? table.rows.length : 0)
  }, 0)

  return {
    tables,
    tableCount: Number(payload?.summary?.table_count || tables.length),
    totalRows: Number(payload?.summary?.total_rows || totalRows)
  }
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

const triggerBlobDownload = (blob, filename) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

const triggerExcelDownload = (buffer, filename) => {
  triggerBlobDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }),
    filename
  )
}

const triggerJsonDownload = (payload, filename) => {
  triggerBlobDownload(
    new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8'
    }),
    filename
  )
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

const tenantFieldClass =
  'h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100'

const tenantMetricToneClass = {
  blue: 'border-blue-200 bg-blue-50/70 text-blue-700',
  emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-700',
  amber: 'border-amber-200 bg-amber-50/70 text-amber-700',
  indigo: 'border-indigo-200 bg-indigo-50/70 text-indigo-700',
  slate: 'border-slate-200 bg-white text-slate-700'
}

function TenantMetricCard({ icon: Icon, label, value, description, tone = 'slate' }) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tenantMetricToneClass[tone] || tenantMetricToneClass.slate}`}>
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

function TenantSchoolCard({ tenant, host, selected, onSelect }) {
  const status = String(tenant?.status || 'unknown').toLowerCase()
  const statusLabel = tenant?.status || 'unknown'
  const createdLabel = tenant?.created_at ? formatDateTime(tenant.created_at) : '-'

  return (
    <article
      className={`group min-h-[228px] rounded-2xl border bg-white p-5 text-left shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-card-hover ${
        selected ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-100'
      }`}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700 transition group-hover:bg-blue-100">
              <School className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-slate-950">{tenant?.name || 'Sekolah'}</p>
              <p className="mt-1 truncate text-xs font-medium text-slate-500">{tenant?.slug || tenant?.id || '-'}</p>
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${tenantStatusBadgeClass(status)}`}>
            {statusLabel}
          </span>
        </div>

        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="flex items-start gap-2">
              <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Subdomain</p>
                <p className="mt-1 truncate text-sm font-semibold text-slate-900">{host || '-'}</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Dibuat</p>
              <p className="mt-1 truncate text-xs font-semibold text-slate-700">{createdLabel}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Tenant ID</p>
              <p className="mt-1 truncate text-xs font-semibold text-slate-700">{tenant?.id || '-'}</p>
            </div>
          </div>
        </div>
      </button>

      <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onSelect?.()
          }}
          className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          <UserCog className="h-4 w-4" />
          Kelola
        </button>
        <a
          href={`/admin/storage?tenant=${encodeURIComponent(tenant?.id || '')}`}
          onClick={(event) => event.stopPropagation()}
          className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 no-underline transition hover:bg-slate-50"
        >
          <HardDrive className="h-4 w-4" />
          Storage
        </a>
      </div>
    </article>
  )
}

function TenantEmptyState({ title, description }) {
  return (
    <div className="px-5 py-12 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <School className="h-7 w-7" />
      </div>
      <p className="mt-4 text-sm font-bold text-slate-700">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
  )
}

const Tenants = () => {
  const { isSuperAdmin, superAdminChecked } = useAuthStore()
  const { pushToast } = useUIStore()

  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [slugTouched, setSlugTouched] = useState(false)

  const [selectedTenantId, setSelectedTenantId] = useState('')
  const [detailTab, setDetailTab] = useState('overview')
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
  const [backupDriveSaving, setBackupDriveSaving] = useState(false)
  const [backupMonthlyStatus, setBackupMonthlyStatus] = useState(null)
  const [backupMonthlyLoading, setBackupMonthlyLoading] = useState(false)
  const [backupMonthlySavingKey, setBackupMonthlySavingKey] = useState('')
  const [backupMonthlyAutoSaving, setBackupMonthlyAutoSaving] = useState(false)
  const [backupMonthlyProgress, setBackupMonthlyProgress] = useState(null)
  const [statusSaving, setStatusSaving] = useState(false)
  const [mosquittoProvisioning, setMosquittoProvisioning] = useState(false)
  const [rfidDevices, setRfidDevices] = useState(null)
  const [rfidDevicesLoading, setRfidDevicesLoading] = useState(false)
  const [showAddDeviceModal, setShowAddDeviceModal] = useState(false)
  const [addDeviceSaving, setAddDeviceSaving] = useState(false)
  const [deviceDeletingById, setDeviceDeletingById] = useState({})
  const [addDeviceForm, setAddDeviceForm] = useState({
    device_id: '',
    name: '',
    board_type: 'esp8266',
    location: '',
    reader_model: 'pn532-spi'
  })
  const [selectedDeviceDetail, setSelectedDeviceDetail] = useState(null)
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
  const [tenantSearch, setTenantSearch] = useState('')
  const [tenantStatusFilter, setTenantStatusFilter] = useState('all')

  const rootDomain = useMemo(() => getRootDomain(), [])
  const platformRootDomain = platformDomains?.platform?.root_domain || rootDomain
  const previewDomain = form.slug && platformRootDomain ? `${form.slug}.${platformRootDomain}` : ''

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

  useEffect(() => {
    if (detailTab !== 'backup' || !selectedTenantId) return
    loadTenantBackupMonthlyStatus({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailTab, selectedTenantId])

  useEffect(() => {
    if (detailTab !== 'devices' || !selectedTenantId) return
    loadRfidDevices(selectedTenantId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailTab, selectedTenantId])

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

  const handleRfidWifiField = (field) => (event) => {
    const value = event.target.value
    setRfidWifiForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (saving) return

    const schoolName = form.name.trim()
    const tenantSlug = slugify(form.slug)
    const adminName = form.adminName.trim()
    const adminEmail = form.adminEmail.trim().toLowerCase()
    const adminPassword = form.adminPassword

    if (!schoolName || !tenantSlug || !adminName || !adminEmail || !adminPassword) {
      pushToast('error', 'Lengkapi semua field terlebih dahulu')
      return
    }
    if (!isValidTenantSlug(tenantSlug)) {
      pushToast('error', 'Subdomain hanya boleh huruf kecil, angka, dan tanda hubung. Panjang 3-63 karakter.')
      return
    }
    if (isReservedTenantSlug(tenantSlug)) {
      pushToast('error', `Subdomain ${tenantSlug} dipakai oleh platform dan tidak bisa digunakan sekolah.`)
      return
    }
    if (!isValidEmail(adminEmail)) {
      pushToast('error', 'Email admin sekolah tidak valid.')
      return
    }
    const passwordCheck = validatePassword(adminPassword)
    if (!passwordCheck.valid) {
      pushToast('error', `Password admin sekolah belum sesuai: ${passwordCheck.errors.join(', ')}.`)
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: schoolName,
        slug: tenantSlug,
        admin_name: adminName,
        admin_email: adminEmail,
        admin_password: adminPassword
      }
      const { data, error } = await supabase.super.createTenant(payload)
      if (error) throw error

      pushToast('success', `${schoolName} berhasil dibuat di ${previewDomain || `${tenantSlug}.${platformRootDomain}` || tenantSlug}.`, {
        title: 'Tenant sekolah aktif'
      })
      resetForm()
      await loadTenants()

      const newTenantId = data?.tenant?.id
      if (newTenantId) {
        setSelectedTenantId(newTenantId)
        setDetailTab('overview')
        setTemporaryPasswords({})
        await loadTenantDetail(newTenantId)
      }

      if (data?.admin?.email) {
        pushToast('info', `Admin sekolah: ${data.admin.email}`, {
          title: 'Akun admin dibuat'
        })
      }
    } catch (err) {
      pushToast('error', err?.message || 'Gagal membuat sekolah')
    } finally {
      setSaving(false)
    }
  }

  const loadRfidDevices = async (tenantId) => {
    if (!tenantId) return
    setRfidDevicesLoading(true)
    try {
      const { data, error } = await supabase.super.tenantRfidDevices(tenantId)
      if (error) throw error
      setRfidDevices(data || null)
    } catch (err) {
      pushToast('error', err?.message || 'Gagal memuat daftar device RFID')
    } finally {
      setRfidDevicesLoading(false)
    }
  }

  const handleSelectTenant = async (tenantId) => {
    if (!tenantId) return
    setSelectedTenantId(tenantId)
    setDetailTab('overview')
    setTemporaryPasswords({})
    setPrimaryAdminSavingByUser({})
    resetTenantDomainForm()
    setRfidWifiForm({ ssid: '', password: '' })
    setRfidDevices(null)
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

  const handleBackupTenant = async (format = 'xlsx') => {
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

      const baseFilename = buildBackupFileName(data?.tenant, data?.mode || selectedMode)
      const normalizedFormat = format === 'json' ? 'json' : 'xlsx'
      const filename = normalizedFormat === 'json'
        ? baseFilename.replace(/\.xlsx$/i, '.json')
        : baseFilename

      if (normalizedFormat === 'json') {
        triggerJsonDownload(data, filename)
      } else {
        const buffer = await createWorkbookBufferFromBackupPayload(data)
        triggerExcelDownload(buffer, filename)
      }

      const modeLabel = data?.mode_label || getBackupModeLabel(data?.mode || selectedMode)
      const periodLabel = data?.period?.label ? ` (${data.period.label})` : ''
      const formatLabel = normalizedFormat === 'json' ? 'JSON siap restore' : 'Excel'
      pushToast('success', `${modeLabel}${periodLabel} ${formatLabel} berhasil diunduh: ${filename}`)
    } catch (err) {
      pushToast('error', err?.message || 'Gagal membuat backup tenant')
    } finally {
      setBackupLoading(false)
    }
  }

  const loadTenantBackupMonthlyStatus = async ({ silent = false, refresh = false } = {}) => {
    const tenantId = tenantDetail?.tenant?.id || selectedTenantId
    if (!tenantId) return null

    setBackupMonthlyLoading(true)
    try {
      const { data, error } = await supabase.super.tenantBackupMonthlyStatus(tenantId, { refresh })
      if (error) throw error
      setBackupMonthlyStatus(data || null)
      return data || null
    } catch (err) {
      if (!silent) pushToast('error', err?.message || 'Gagal memuat jadwal backup bulanan tenant')
      return null
    } finally {
      setBackupMonthlyLoading(false)
    }
  }

  const waitForTenantMonthlyJob = async (tenantId, jobId, { auto = false } = {}) => {
    let lastStatus = null

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 900 : 2500))
      const { data, error } = await supabase.super.tenantMonthlyBackupJobStatus(tenantId, jobId)
      if (error) throw error

      lastStatus = data || null
      const numericProgress = Number(lastStatus?.progress)
      setBackupMonthlyProgress({
        label: lastStatus?.message || (auto ? 'Auto backup tenant sedang berjalan...' : 'Backup bulanan tenant sedang berjalan...'),
        percent: Number.isFinite(numericProgress) ? numericProgress : Math.min(95, 18 + attempt)
      })

      if (lastStatus?.monthly_status) {
        setBackupMonthlyStatus(lastStatus.monthly_status)
      }

      if (lastStatus?.status === 'finished') return lastStatus
      if (lastStatus?.status === 'failed' || lastStatus?.status === 'missing') {
        throw new Error(lastStatus?.message || 'Backup bulanan tenant gagal diproses')
      }
    }

    return lastStatus || { status: 'running', message: 'Backup masih diproses di background.' }
  }

  const handleSaveTenantBackupToDrive = async () => {
    const tenantId = tenantDetail?.tenant?.id || selectedTenantId
    if (!tenantId || backupDriveSaving || backupLoading) return

    setBackupDriveSaving(true)
    try {
      const selectedMode = String(backupMode || 'full').trim() || 'full'
      const selectedMonths =
        selectedMode === 'students' && backupMonths !== 'all' ? Number(backupMonths) : undefined
      const { data, error } = await supabase.super.saveTenantBackupToGoogleDrive(tenantId, {
        mode: selectedMode,
        period_type: selectedMonths ? 'last_months' : 'all',
        months: selectedMonths
      })
      if (error) throw error
      await loadTenantBackupMonthlyStatus({ silent: true, refresh: true })
      const fileName = data?.drive_file?.drive_file_name || 'backup.json'
      pushToast('success', `Backup tenant tersimpan di Google Drive: ${fileName}`)
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menyimpan backup tenant ke Google Drive')
    } finally {
      setBackupDriveSaving(false)
    }
  }

  const handleSaveTenantMonthlyBackup = async (monthKey, force = false) => {
    const tenantId = tenantDetail?.tenant?.id || selectedTenantId
    if (!tenantId || !monthKey || backupMonthlySavingKey || backupMonthlyAutoSaving || backupDriveSaving || backupLoading) return

    setBackupMonthlySavingKey(monthKey)
    setBackupMonthlyProgress({ label: 'Memasukkan backup bulanan tenant ke antrean...', percent: 8 })
    try {
      const { data, error } = await supabase.super.saveTenantMonthlyBackupToGoogleDrive(tenantId, { month: monthKey, force, async: true })
      if (error) throw error

      let finalData = data
      if (data?.monthly_status) setBackupMonthlyStatus(data.monthly_status)
      if (data?.queued && data?.job_id) {
        setBackupMonthlyProgress({ label: data?.job?.message || 'Backup tenant sedang diproses...', percent: 15 })
        pushToast(
          data?.already_queued ? 'warning' : 'success',
          data?.already_queued
            ? 'Backup bulanan tenant ini masih berjalan. Status akan dilanjutkan otomatis.'
            : 'Backup bulanan tenant masuk antrean.'
        )
        finalData = await waitForTenantMonthlyJob(tenantId, data.job_id)
        if (finalData?.status !== 'finished') {
          setBackupMonthlyProgress({ label: finalData?.message || 'Backup tenant masih diproses di background.', percent: 95 })
          pushToast('warning', 'Backup tenant masih diproses di background. Klik Refresh untuk melihat status terbaru.')
          return
        }
      }

      setBackupMonthlyProgress({ label: 'Backup bulanan tenant berhasil disimpan.', percent: 100 })
      if (finalData?.monthly_status) {
        setBackupMonthlyStatus(finalData.monthly_status)
      } else {
        await loadTenantBackupMonthlyStatus({ silent: true, refresh: true })
      }
      pushToast('success', 'Backup bulanan tenant berhasil disimpan ke Google Drive')
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menyimpan backup bulanan tenant')
    } finally {
      setBackupMonthlySavingKey('')
      window.setTimeout(() => setBackupMonthlyProgress(null), 900)
    }
  }

  const handleAutoTenantMonthlyBackup = async () => {
    const tenantId = tenantDetail?.tenant?.id || selectedTenantId
    if (!tenantId || backupMonthlyAutoSaving || backupMonthlySavingKey || backupDriveSaving || backupLoading) return

    setBackupMonthlyAutoSaving(true)
    setBackupMonthlyProgress({ label: 'Memasukkan auto backup tenant ke antrean...', percent: 5 })
    try {
      const { data, error } = await supabase.super.autoTenantMonthlyBackupToGoogleDrive(tenantId, { async: true })
      if (error) throw error

      let finalData = data
      if (data?.monthly_status) setBackupMonthlyStatus(data.monthly_status)
      if (data?.queued && data?.job_id) {
        setBackupMonthlyProgress({ label: data?.job?.message || 'Auto backup tenant sedang diproses...', percent: 15 })
        pushToast(
          data?.already_queued ? 'warning' : 'success',
          data?.already_queued
            ? 'Auto backup tenant ini masih berjalan. Status akan dilanjutkan otomatis.'
            : 'Auto backup tenant masuk antrean.'
        )
        finalData = await waitForTenantMonthlyJob(tenantId, data.job_id, { auto: true })
        if (finalData?.status !== 'finished') {
          setBackupMonthlyProgress({ label: finalData?.message || 'Auto backup tenant masih diproses di background.', percent: 95 })
          pushToast('warning', 'Auto backup tenant masih diproses di background. Klik Refresh untuk melihat status terbaru.')
          return
        }
      }

      setBackupMonthlyProgress({ label: 'Auto backup tenant selesai.', percent: 100 })
      if (finalData?.monthly_status) setBackupMonthlyStatus(finalData.monthly_status)
      const summary = finalData?.result?.summary || finalData?.summary || {}
      const serverTimeLabel = summary.server_time_label ? ` Diproses sampai ${summary.server_time_label}.` : ''
      pushToast(Number(summary.failed || 0) > 0 ? 'warning' : 'success', `${summary.message || 'Auto backup tenant selesai'}${serverTimeLabel}`)
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menjalankan auto backup tenant')
    } finally {
      setBackupMonthlyAutoSaving(false)
      window.setTimeout(() => setBackupMonthlyProgress(null), 1100)
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
      event.target.value = ''
      pushToast('error', err?.message || 'Gagal membaca file backup JSON')
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
      const result = data?.result || null
      setRestorePreview(result)
      const toast = buildRestoreStatusToast(result, { fallbackAction: 'Dry-run restore tenant' })
      pushToast(toast.type, toast.message, { title: toast.title, duration: toast.duration })
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
      'Jalankan restore nyata sekarang? Sistem akan upsert data yang cocok dan melewati konflik tenant agar tidak ganda.'
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

      const result = data?.result || null
      setRestorePreview(result)
      const toast = buildRestoreStatusToast(result, { fallbackAction: 'Restore tenant' })
      pushToast(toast.type, toast.message, { title: toast.title, duration: toast.duration })
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

  const handleAddDeviceSubmit = async (e) => {
    e.preventDefault()
    if (!selectedTenantId) return
    if (!addDeviceForm.device_id.trim()) {
      pushToast('error', 'Device ID wajib diisi')
      return
    }

    setAddDeviceSaving(true)
    try {
      const payload = {
        device_id: addDeviceForm.device_id.trim(),
        name: addDeviceForm.name.trim() || undefined,
        transport: 'mqtt',
        board_type: addDeviceForm.board_type || 'esp8266',
        location: addDeviceForm.location.trim() || undefined,
        reader_model: addDeviceForm.reader_model.trim() || 'pn532-spi'
      }

      const { error } = await supabase.super.storeTenantRfidDevice(selectedTenantId, payload)
      if (error) throw error

      pushToast('success', 'Alat RFID berhasil ditambahkan')
      setShowAddDeviceModal(false)
      setAddDeviceForm({
        device_id: '',
        name: '',
        board_type: 'esp8266',
        location: '',
        reader_model: 'pn532-spi'
      })
      await loadRfidDevices(selectedTenantId)
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menambahkan alat RFID')
    } finally {
      setAddDeviceSaving(false)
    }
  }

  const setDeviceDeleting = (deviceKey, value) => {
    setDeviceDeletingById((prev) => {
      const next = { ...prev }
      if (value) {
        next[deviceKey] = true
      } else {
        delete next[deviceKey]
      }
      return next
    })
  }

  const handleDeleteRfidDevice = async (device) => {
    const tenantId = tenantDetail?.tenant?.id || selectedTenantId
    const deviceKey = String(device?.id || device?.device_id || '')
    const deviceLabel = String(device?.name || device?.device_id || 'alat RFID')
    if (!tenantId || !deviceKey || deviceDeletingById[deviceKey]) return

    if (device?.template_managed) {
      pushToast('error', 'Alat template utama dikelola otomatis. Hapus alat operasional tambahan dari daftar.')
      return
    }

    const confirmed = window.confirm(
      `Hapus ${deviceLabel}? Riwayat scan lama tetap tersimpan, tetapi device ini tidak bisa dipakai lagi sampai didaftarkan ulang.`
    )
    if (!confirmed) return

    setDeviceDeleting(deviceKey, true)
    try {
      const { error } = await supabase.super.deleteTenantRfidDevice(tenantId, deviceKey)
      if (error) throw error

      pushToast('success', `${deviceLabel} berhasil dihapus`)
      if (selectedDeviceDetail && String(selectedDeviceDetail.id || selectedDeviceDetail.device_id) === deviceKey) {
        setSelectedDeviceDetail(null)
      }
      await loadRfidDevices(tenantId)
      await loadTenantDetail(tenantId, { silent: true, suppressToast: true })
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menghapus alat RFID')
    } finally {
      setDeviceDeleting(deviceKey, false)
    }
  }

  const detailRfidTemplate = tenantDetail?.rfid_template || null
  const detailRfidMqttConfig = tenantDetail?.rfid_mqtt_config || {}
  const detailRfidMosquittoActive = Boolean(
    detailRfidMqttConfig?.available && detailRfidMqttConfig?.managed_by_platform
  )
  const detailTenantSlug = tenantDetail?.tenant?.slug || detailRfidTemplate?.tenant_slug || ''
  const mqttTopicPreview = useMemo(
    () => {
      const templates = detailRfidTemplate?.topic_templates || STANDARD_RFID_MQTT_TOPICS

      return [
        {
          key: 'scan',
          label: 'Scan',
          template: templates.scan || STANDARD_RFID_MQTT_TOPICS.scan,
          preview: renderMqttTopicTemplate(templates.scan || STANDARD_RFID_MQTT_TOPICS.scan, detailTenantSlug)
        },
        {
          key: 'response',
          label: 'Response',
          template: templates.response || STANDARD_RFID_MQTT_TOPICS.response,
          preview: renderMqttTopicTemplate(templates.response || STANDARD_RFID_MQTT_TOPICS.response, detailTenantSlug)
        },
        {
          key: 'mode',
          label: 'Mode',
          template: templates.mode || STANDARD_RFID_MQTT_TOPICS.mode,
          preview: renderMqttTopicTemplate(templates.mode || STANDARD_RFID_MQTT_TOPICS.mode, detailTenantSlug)
        }
      ]
    },
    [detailRfidTemplate, detailTenantSlug]
  )
  const selectedDeviceRfidTemplate = useMemo(() => {
    if (!detailRfidTemplate || !selectedDeviceDetail) return ''
    const templates = detailRfidTemplate.topic_templates || STANDARD_RFID_MQTT_TOPICS
    const deviceId = String(selectedDeviceDetail.device_id || '').trim()
    const specificTemplate = {
      ...detailRfidTemplate,
      device_id: deviceId,
      device_name: selectedDeviceDetail.name || deviceId,
      board_type: selectedDeviceDetail.board_type || 'esp8266',
      topics: {
        scan: renderMqttTopicTemplate(templates.scan || STANDARD_RFID_MQTT_TOPICS.scan, detailTenantSlug, deviceId),
        response: renderMqttTopicTemplate(templates.response || STANDARD_RFID_MQTT_TOPICS.response, detailTenantSlug, deviceId),
        mode: renderMqttTopicTemplate(templates.mode || STANDARD_RFID_MQTT_TOPICS.mode, detailTenantSlug, deviceId)
      }
    }

    return specificTemplate
  }, [detailRfidTemplate, detailTenantSlug, selectedDeviceDetail])
  const deviceArduinoCode = useMemo(() => {
    if (!selectedDeviceRfidTemplate) return ''
    return buildTenantRfidArduinoCode(selectedDeviceRfidTemplate, rfidWifiForm)
  }, [selectedDeviceRfidTemplate, rfidWifiForm])

  const rfidWifiReady = rfidWifiForm.ssid.trim() !== '' && rfidWifiForm.password.trim() !== ''

  const handleCopyRfidArduinoCode = async () => {
    if (!deviceArduinoCode) {
      pushToast('error', 'Template Arduino RFID belum tersedia')
      return
    }

    try {
      const copied = await copyText(deviceArduinoCode)
      if (!copied) throw new Error('Clipboard tidak tersedia')
      pushToast('success', 'Kode Arduino RFID siap flash berhasil dicopy')
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menyalin kode Arduino RFID')
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
  const backupMonthlyMonths = Array.isArray(backupMonthlyStatus?.months) ? backupMonthlyStatus.months : []
  const detailDomains = Array.isArray(tenantDetail?.domains) ? tenantDetail.domains : []
  const detailRfidNotes = Array.isArray(detailRfidTemplate?.notes) ? detailRfidTemplate.notes : []
  const primaryAdminUserId = String(detailTenant?.primary_admin_user_id || '')
  const primaryAdminInfo = detailAdmins.find(
    (admin) => String(admin?.user_id || '') === primaryAdminUserId
  )
  const platformOverview = platformDomains?.platform || {}
  const adminDomains = Array.isArray(platformDomains?.admin_domains) ? platformDomains.admin_domains : []
  const tenantSummary = tenants.reduce(
    (summary, tenant) => {
      const status = String(tenant?.status || '').toLowerCase()
      return {
        total: summary.total + 1,
        active: summary.active + (status === 'active' ? 1 : 0),
        suspended: summary.suspended + (status === 'suspended' ? 1 : 0),
        archived: summary.archived + (status === 'archived' ? 1 : 0)
      }
    },
    { total: 0, active: 0, suspended: 0, archived: 0 }
  )
  const selectedTenantRow = tenants.find((tenant) => tenant.id === selectedTenantId)
  const readyAdminDomains = adminDomains.filter((domain) => domain?.status === 'ready').length
  const normalizedTenantSearch = tenantSearch.trim().toLowerCase()
  const filteredTenants = tenants.filter((tenant) => {
    const status = String(tenant?.status || '').toLowerCase()
    const matchesSearch = !normalizedTenantSearch || [
      tenant?.name,
      tenant?.slug,
      tenant?.id
    ].some((value) => String(value || '').toLowerCase().includes(normalizedTenantSearch))
    const matchesStatus = tenantStatusFilter === 'all' || status === tenantStatusFilter

    return matchesSearch && matchesStatus
  })
  const formSlug = slugify(form.slug)
  const formSlugReserved = formSlug ? isReservedTenantSlug(formSlug) : false
  const formSlugValid = formSlug ? isValidTenantSlug(formSlug) && !formSlugReserved : false
  const tenantPreviewFallback = platformRootDomain ? `smabali.${platformRootDomain}` : 'smabali.sismu.biz.id'
  const tenantPreviewHost = formSlug && platformRootDomain ? `${formSlug}.${platformRootDomain}` : tenantPreviewFallback
  const selectedTenantHost = selectedTenantRow?.slug
    ? `${selectedTenantRow.slug}.${platformRootDomain || rootDomain || 'domain'}`
    : ''
  const restorePayloadSummary = summarizeBackupPayload(restorePayload)
  const restorePayloadPreviewTables = restorePayloadSummary.tables.slice(0, 8)
  const restorePreviewSummary = restorePreview?.summary || {}
  const restorePreviewIsApply = restorePreview && restorePreviewSummary?.dry_run === false
  const restoreInsertLabel = restorePreviewIsApply ? 'Inserted' : 'Would Insert'
  const restoreUpdateLabel = restorePreviewIsApply ? 'Updated' : 'Would Update'
  const restoreInsertCount = restorePreviewIsApply
    ? toNumber(restorePreviewSummary?.inserted || restorePreviewSummary?.would_insert)
    : toNumber(restorePreviewSummary?.would_insert || restorePreviewSummary?.inserted)
  const restoreUpdateCount = restorePreviewIsApply
    ? toNumber(restorePreviewSummary?.updated || restorePreviewSummary?.would_update)
    : toNumber(restorePreviewSummary?.would_update || restorePreviewSummary?.updated)
  const detailTabBadges = {
    admins: detailAdmins.length ? numberFormatter.format(detailAdmins.length) : '',
    domains: detailDomains.length ? numberFormatter.format(detailDomains.length) : '',
    backup: restoreFileName ? 'file siap' : '',
    devices: detailRfidMosquittoActive ? 'aktif' : ''
  }

  return (
    <div className="page-wrapper">
      <div className="w-full space-y-6">
      <div className="page-title-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="page-title-heading">Manajemen Sekolah</h1>
              <p className="page-title-description">
                Buat tenant sekolah, pantau status domain, dan kelola akses admin dari satu halaman.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
              <Globe2 className="h-3.5 w-3.5" />
              {platformRootDomain || rootDomain || 'Root domain belum diatur'}
            </span>
            <button
              type="button"
              onClick={() => {
                loadTenants()
                loadPlatformDomains()
              }}
              disabled={loading || platformLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading || platformLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TenantMetricCard
          icon={School}
          label="Total sekolah"
          value={numberFormatter.format(tenantSummary.total)}
          description={`${numberFormatter.format(filteredTenants.length)} tampil sesuai filter`}
          tone="blue"
        />
        <TenantMetricCard
          icon={CheckCircle2}
          label="Aktif"
          value={numberFormatter.format(tenantSummary.active)}
          description="Tenant siap digunakan"
          tone="emerald"
        />
        <TenantMetricCard
          icon={XCircle}
          label="Suspended"
          value={numberFormatter.format(tenantSummary.suspended)}
          description={`${numberFormatter.format(tenantSummary.archived)} archived`}
          tone="amber"
        />
        <TenantMetricCard
          icon={ShieldCheck}
          label="Host admin"
          value={numberFormatter.format(readyAdminDomains)}
          description={`${numberFormatter.format(adminDomains.length)} custom host`}
          tone="indigo"
        />
      </div>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Daftar Sekolah</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Pilih sekolah untuk membuka detail admin, domain, backup, dan konfigurasi perangkat. Storage dikelola dari menu Storage VPS.
                </p>
              </div>
              {selectedTenantId && (
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm">
                  <p className="font-semibold text-indigo-800">
                    {selectedTenantRow?.name || detailTenant?.name || 'Sekolah dipilih'}
                  </p>
                  <p className="mt-1 text-xs text-indigo-700">{selectedTenantHost || 'Memuat host tenant...'}</p>
                </div>
              )}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_180px_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={tenantSearch}
                  onChange={(event) => setTenantSearch(event.target.value)}
                  placeholder="Cari nama sekolah, slug, atau tenant ID"
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
              </div>
              <select
                value={tenantStatusFilter}
                onChange={(event) => setTenantStatusFilter(event.target.value)}
                className={tenantFieldClass}
              >
                <option value="all">Semua status</option>
                {TENANT_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setTenantSearch('')
                  setTenantStatusFilter('all')
                }}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <Filter className="h-4 w-4" />
                Reset
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-3 px-5 py-12 text-sm font-semibold text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              Memuat data sekolah...
            </div>
          ) : tenants.length === 0 ? (
            <TenantEmptyState
              title="Belum ada sekolah"
              description="Buat tenant sekolah pertama dari panel di sisi kanan."
            />
          ) : filteredTenants.length === 0 ? (
            <TenantEmptyState
              title="Tidak ada sekolah yang cocok"
              description="Ubah kata kunci atau filter status untuk melihat sekolah lain."
            />
          ) : (
            <div className="grid gap-4 p-5 lg:grid-cols-2 2xl:grid-cols-3">
              {filteredTenants.map((tenant) => {
                const tenantHost = tenant.slug ? `${tenant.slug}.${platformRootDomain || rootDomain}` : '-'
                return (
                  <TenantSchoolCard
                    key={tenant.id}
                    tenant={tenant}
                    host={tenantHost}
                    selected={selectedTenantId === tenant.id}
                    onSelect={() => handleSelectTenant(tenant.id)}
                  />
                )
              })}
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
                  <PlusCircle className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Buat Sekolah</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Tenant, subdomain, dan akun admin sekolah dibuat dalam satu proses.
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-5">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">Nama Sekolah</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={handleChange('name')}
                  placeholder="Contoh: SMA Negeri 1"
                  className={tenantFieldClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">Subdomain Sekolah</label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={handleChange('slug')}
                  placeholder="contoh: sma1"
                  className={`${tenantFieldClass} ${formSlug && !formSlugValid ? 'border-amber-300 focus:border-amber-500 focus:ring-amber-100' : ''}`}
                />
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <p className="font-semibold text-slate-700">Preview URL</p>
                  <p className="mt-1 break-all">{tenantPreviewHost}</p>
                  {formSlug && !formSlugValid && (
                    <p className="mt-1 text-amber-700">
                      Subdomain belum valid atau termasuk reserved platform.
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">Nama Admin</label>
                  <input
                    type="text"
                    value={form.adminName}
                    onChange={handleChange('adminName')}
                    placeholder="Nama admin"
                    className={tenantFieldClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">Email Admin</label>
                  <input
                    type="email"
                    value={form.adminEmail}
                    onChange={handleChange('adminEmail')}
                    placeholder="admin@sekolah.com"
                    className={tenantFieldClass}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">Password Admin</label>
                <PasswordInput
                  value={form.adminPassword}
                  onChange={handleChange('adminPassword')}
                  placeholder="Minimal 12 karakter + kompleks"
                  className={tenantFieldClass}
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
                {saving ? 'Menyimpan...' : 'Buat Sekolah'}
              </button>
            </form>
          </section>

        </aside>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Konfigurasi Platform & DNS</h2>
            <p className="mt-1 text-sm text-slate-600">
              Pantau host admin dan domain platform dari satu area operasional.
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

            <div className="grid gap-4">
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
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">
                    {detailTenant?.name || 'Detail Sekolah'}
                  </h2>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tenantStatusBadgeClass(
                      detailTenant?.status
                    )}`}
                  >
                    {detailTenant?.status || 'unknown'}
                  </span>
                </div>
                <p className="mt-1 break-all text-sm text-slate-600">
                  {detailTenant?.slug ? `${detailTenant.slug}.${platformRootDomain || rootDomain}` : '-'}
                </p>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <p className="font-semibold text-slate-500">Admin utama</p>
                    <p className="mt-1 truncate text-slate-800">
                      {primaryAdminInfo?.name ||
                        primaryAdminInfo?.email ||
                        detailTenant?.primary_admin_name ||
                        'Belum ditetapkan'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <p className="font-semibold text-slate-500">Update status</p>
                    <p className="mt-1 text-slate-800">{formatDateTime(detailTenant?.status_changed_at)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 sm:col-span-2 xl:col-span-1">
                    <p className="font-semibold text-slate-500">Alasan status</p>
                    <p className="mt-1 truncate text-slate-800">{detailTenant?.status_reason || '-'}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRefreshDetail}
                  disabled={detailRefreshing || detailLoading}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  <RefreshCw className={`h-4 w-4 ${detailRefreshing ? 'animate-spin' : ''}`} />
                  {detailRefreshing ? 'Refresh...' : 'Refresh Detail'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTenantId('')
                    setDetailTab('overview')
                    setTenantDetail(null)
                    setDetailError('')
                    setTemporaryPasswords({})
                    setPrimaryAdminSavingByUser({})
                    resetTenantDomainForm()
                    setRfidWifiForm({ ssid: '', password: '' })
                    setRestorePayload(null)
                    setRestoreFileName('')
                    setRestorePreview(null)
                    setRestoreIncludeTables('')
                  }}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Tutup
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.65fr)]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">Status Tenant</p>
                    <p className="mt-1 text-xs text-slate-500">Aktifkan, suspend, atau arsipkan sekolah.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {TENANT_STATUS_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleTenantStatusUpdate(option.value)}
                        disabled={statusSaving || detailLoading || detailTenant?.status === option.value}
                        className={`h-9 rounded-xl border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          option.value === 'active'
                            ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                            : option.value === 'suspended'
                              ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                              : 'border-rose-200 text-rose-700 hover:bg-rose-50'
                        }`}
                      >
                        {statusSaving && detailTenant?.status !== option.value ? 'Menyimpan...' : option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                    <Database className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-900">Backup Data Tenant</p>
                    <div className="mt-3 grid gap-2">
                      <select
                        id="tenant-backup-mode"
                        value={backupMode}
                        onChange={(event) => {
                          const nextMode = event.target.value
                          setBackupMode(nextMode)
                          if (nextMode !== 'students') {
                            setBackupMonths('all')
                          }
                        }}
                        disabled={backupLoading || detailLoading}
                        className={tenantFieldClass}
                      >
                        {BACKUP_MODE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {backupMode === 'students' && (
                        <select
                          id="tenant-backup-period"
                          value={backupMonths}
                          onChange={(event) => setBackupMonths(event.target.value)}
                          disabled={backupLoading || detailLoading}
                          className={tenantFieldClass}
                        >
                          {BACKUP_PERIOD_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      )}
                      <div className="grid gap-2 sm:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => handleBackupTenant('xlsx')}
                          disabled={backupLoading || backupDriveSaving || detailLoading}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                        >
                          {backupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                          {backupLoading ? 'Menyiapkan...' : 'Excel'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBackupTenant('json')}
                          disabled={backupLoading || backupDriveSaving || detailLoading}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 text-sm font-bold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60"
                        >
                          {backupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                          JSON Restore
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveTenantBackupToDrive}
                          disabled={backupLoading || backupDriveSaving || detailLoading}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-bold text-blue-700 transition hover:bg-blue-100 disabled:opacity-60"
                        >
                          {backupDriveSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                          {backupDriveSaving ? 'Menyimpan...' : 'Simpan JSON + Excel'}
                        </button>
                      </div>

                      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2">
                            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                            <div>
                              <p className="text-xs font-black uppercase tracking-wide text-amber-800">Backup Bulanan</p>
                              <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">
                                Auto backup lengkap akhir bulan {backupMonthlyStatus?.schedule?.runs_at_label || '23:15 WIB bertahap'}. Kuning berarti bulan itu sudah tersimpan.
                                {backupMonthlyStatus?.schedule?.server_time_label ? ` Waktu server: ${backupMonthlyStatus.schedule.server_time_label}.` : ''}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={handleAutoTenantMonthlyBackup}
                              disabled={backupMonthlyAutoSaving || backupMonthlySavingKey || backupMonthlyLoading}
                              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-blue-600 px-2 text-[11px] font-bold text-white disabled:opacity-60"
                            >
                              <UploadCloud className={`h-3.5 w-3.5 ${backupMonthlyAutoSaving ? 'animate-bounce' : ''}`} />
                              {backupMonthlyAutoSaving ? 'Auto...' : 'Auto'}
                            </button>
                            <button
                              type="button"
                              onClick={() => loadTenantBackupMonthlyStatus({ refresh: true })}
                              disabled={backupMonthlyLoading || backupMonthlyAutoSaving || Boolean(backupMonthlySavingKey)}
                              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-white px-2 text-[11px] font-bold text-amber-800 ring-1 ring-amber-200 disabled:opacity-60"
                            >
                              <RefreshCw className={`h-3.5 w-3.5 ${backupMonthlyLoading ? 'animate-spin' : ''}`} />
                              Refresh
                            </button>
                          </div>
                        </div>
                        {backupMonthlyProgress ? (
                          <div className="mt-3 rounded-xl border border-blue-200 bg-white px-3 py-2">
                            <div className="flex items-center justify-between gap-3 text-[11px] font-bold text-blue-900">
                              <span>{backupMonthlyProgress.label}</span>
                              <span>{Math.round(Number(backupMonthlyProgress.percent || 0))}%</span>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-100">
                              <div
                                className="h-full rounded-full bg-blue-600 transition-all duration-500"
                                style={{ width: `${Math.max(0, Math.min(100, Number(backupMonthlyProgress.percent || 0)))}%` }}
                              />
                            </div>
                          </div>
                        ) : null}
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {backupMonthlyMonths.length ? backupMonthlyMonths.map((month) => {
                            const backedUp = Boolean(month?.is_backed_up)
                            const needsUpdate = month?.status === 'needs_update' || Boolean(month?.has_new_data)
                            const isFuture = month?.status === 'future'
                            const canBackup = Boolean(month?.can_backup)
                            const file = month?.drive_file || null
                            const cardClass = needsUpdate
                              ? 'border-blue-300 bg-blue-50 text-blue-950'
                              : backedUp
                                ? 'border-amber-300 bg-amber-100 text-amber-950'
                                : 'border-slate-200 bg-white text-slate-700'
                            return (
                              <div
                                key={month.key}
                                className={`rounded-xl border px-3 py-2 ${cardClass}`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-black">{month.short_label || month.label}</p>
                                    <p className="truncate text-[10px] font-semibold opacity-70">
                                      {isFuture ? 'Belum berjalan' : (needsUpdate ? 'Ada data baru' : (backedUp ? file?.size_label || 'Tersimpan' : 'Belum backup'))}
                                    </p>
                                  </div>
                                  {!canBackup ? (
                                    file?.drive_web_view_link ? (
                                      <a
                                        href={file.drive_web_view_link}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="shrink-0 rounded-lg bg-amber-200 px-2 py-1 text-[10px] font-black text-amber-900"
                                      >
                                        Buka
                                      </a>
                                    ) : (
                                      <span className="shrink-0 rounded-lg bg-amber-200 px-2 py-1 text-[10px] font-black text-amber-900">{isFuture ? 'Nanti' : 'Sudah'}</span>
                                    )
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleSaveTenantMonthlyBackup(month.key, backedUp)}
                                      disabled={Boolean(backupMonthlySavingKey) || backupMonthlyAutoSaving}
                                      className="shrink-0 rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-black text-white disabled:opacity-60"
                                    >
                                      {backupMonthlySavingKey === month.key ? 'Proses' : (needsUpdate ? 'Update' : 'Backup')}
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          }) : (
                            <div className="col-span-full rounded-xl border border-dashed border-amber-200 bg-white/70 px-3 py-4 text-center text-xs text-amber-800">
                              {backupMonthlyLoading ? 'Memuat jadwal...' : 'Jadwal bulanan belum dimuat.'}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {detailLoading ? (
            <div className="flex items-center justify-center gap-3 px-5 py-12 text-sm font-semibold text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              Memuat detail sekolah...
            </div>
          ) : detailError ? (
            <div className="m-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-600">
              {detailError}
            </div>
          ) : !tenantDetail ? (
            <div className="px-5 py-8 text-sm text-slate-500">Data detail belum tersedia.</div>
          ) : (
            <div className="space-y-4 p-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-2">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  {TENANT_DETAIL_TABS.map((tab) => {
                    const Icon = tab.icon
                    const isActive = detailTab === tab.value
                    const badge = detailTabBadges[tab.value]
                    return (
                      <button
                        key={tab.value}
                        type="button"
                        onClick={() => setDetailTab(tab.value)}
                        className={`flex min-h-[3.25rem] items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                          isActive
                            ? 'border-blue-200 bg-blue-50 text-blue-800 shadow-sm'
                            : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{tab.label}</span>
                        </span>
                        {badge ? (
                          <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                            {badge}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>

              {detailTab === 'overview' && (
                <>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {statCardsFrom(detailStats).map((item) => (
                      <div key={item.key} className="rounded-xl border border-slate-200 p-4">
                        <p className="text-xs text-slate-500">{item.label}</p>
                        <p className="mt-1 text-2xl font-bold text-slate-900">
                          {numberFormatter.format(item.value)}
                        </p>
                      </div>
                    ))}
                    <div className="col-span-2 rounded-xl border border-slate-200 p-4 lg:col-span-1">
                      <p className="text-xs text-slate-500">Aktivitas Terakhir</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {formatDateTime(detailStats.last_activity_at)}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-4">
                    <button
                      type="button"
                      onClick={() => setDetailTab('admins')}
                      className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-left transition hover:border-indigo-200 hover:bg-indigo-50"
                    >
                      <p className="text-xs font-semibold uppercase text-slate-500">Akses</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">Kelola admin sekolah</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {detailAdmins.length} admin, utama: {primaryAdminInfo?.email || 'belum ditetapkan'}.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab('domains')}
                      className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-left transition hover:border-blue-200 hover:bg-blue-50"
                    >
                      <p className="text-xs font-semibold uppercase text-slate-500">Domain</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">Pantau DNS tenant</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {detailDomains.length} custom domain, host bawaan tetap aktif.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab('backup')}
                      className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50"
                    >
                      <p className="text-xs font-semibold uppercase text-slate-500">Keamanan Data</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">Backup dan restore tenant</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {restoreFileName ? `File restore siap: ${restoreFileName}` : 'Upload JSON untuk dry-run restore.'}
                      </p>
                    </button>
                    <a
                      href={`/admin/storage?tenant=${encodeURIComponent(selectedTenantId)}`}
                      className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-left transition hover:border-cyan-200 hover:bg-cyan-50"
                    >
                      <p className="text-xs font-semibold uppercase text-slate-500">Storage VPS</p>
                      <p className="mt-1 flex items-center gap-2 text-sm font-bold text-slate-900">
                        <HardDrive className="h-4 w-4" />
                        Kelola storage sekolah
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Kuota, Drive, cleanup, trash, dan inventaris file dipusatkan di Storage VPS.
                      </p>
                    </a>
                  </div>
                </>
              )}

              {detailTab === 'devices' && (
                <>
                  {/* Daftar Alat RFID */}
                  <div className="rounded-2xl border border-slate-200 p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">Daftar Alat RFID</h3>
                        <p className="text-xs text-slate-500 mt-1">
                          Monitoring perangkat RFID yang terdaftar untuk sekolah ini.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => loadRfidDevices(selectedTenantId)}
                          disabled={rfidDevicesLoading}
                          className="text-xs px-3 py-1.5 rounded-full border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          {rfidDevicesLoading ? 'Memuat...' : 'Refresh'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAddDeviceForm({
                              device_id: `edusmart-${Math.random().toString(36).substring(2, 8)}`,
                              name: '',
                              board_type: 'esp8266',
                              location: '',
                              reader_model: 'pn532-spi'
                            })
                            setShowAddDeviceModal(true)
                          }}
                          className="text-xs px-3 py-1.5 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
                        >
                          + Tambah Alat
                        </button>
                      </div>
                    </div>

                    {(() => {
                      const summary = rfidDevices?.summary || tenantDetail?.rfid_devices_summary || { total: 0, online: 0, offline: 0 }
                      return (
                        <div className="grid grid-cols-3 gap-3">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
                            <p className="text-[11px] font-semibold uppercase text-slate-500">Total Alat</p>
                            <p className="mt-1 text-xl font-bold text-slate-900">{summary.total}</p>
                          </div>
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
                            <p className="text-[11px] font-semibold uppercase text-emerald-600">Online</p>
                            <p className="mt-1 text-xl font-bold text-emerald-700">{summary.online}</p>
                          </div>
                          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center">
                            <p className="text-[11px] font-semibold uppercase text-rose-600">Offline</p>
                            <p className="mt-1 text-xl font-bold text-rose-700">{summary.offline}</p>
                          </div>
                        </div>
                      )
                    })()}

                    {rfidDevicesLoading ? (
                      <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Memuat daftar device...
                      </div>
                    ) : rfidDevices?.devices?.length ? (
                      <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
                              <th className="px-3 py-2.5 font-semibold">Device ID</th>
                              <th className="px-3 py-2.5 font-semibold">Nama</th>
                              <th className="px-3 py-2.5 font-semibold">Board</th>
                              <th className="px-3 py-2.5 font-semibold">Status</th>
                              <th className="px-3 py-2.5 font-semibold">Transport</th>
                              <th className="px-3 py-2.5 font-semibold">Koneksi</th>
                              <th className="px-3 py-2.5 font-semibold">Last Seen</th>
                              <th className="px-3 py-2.5 font-semibold">IP</th>
                              <th className="px-3 py-2.5 font-semibold text-right">Aksi</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {rfidDevices.devices.map((device) => (
                              <tr key={device.id} className="hover:bg-slate-50/50">
                                <td className="px-3 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                                  {device.device_id || '-'}
                                </td>
                                <td className="px-3 py-2.5 text-slate-700">
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span>{device.name || '-'}</span>
                                      {device.template_managed && (
                                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                          Default
                                        </span>
                                      )}
                                    </div>
                                    {device.location && (
                                      <p className="mt-1 text-[11px] text-slate-500">{device.location}</p>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                                  {(device.board_type || 'esp8266').toUpperCase()}
                                </td>
                                <td className="px-3 py-2.5">
                                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                    device.status === 'active'
                                      ? 'bg-emerald-100 text-emerald-700'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}>
                                    {device.status}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 text-slate-600">{device.transport || '-'}</td>
                                <td className="px-3 py-2.5">
                                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                    device.is_online
                                      ? 'bg-emerald-100 text-emerald-700'
                                      : 'bg-rose-100 text-rose-600'
                                  }`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${
                                      device.is_online ? 'bg-emerald-500 animate-pulse' : 'bg-rose-400'
                                    }`} />
                                    {device.is_online ? 'Online' : 'Offline'}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
                                  {device.last_seen_at ? formatDateTime(device.last_seen_at) : 'Belum pernah'}
                                </td>
                                <td className="px-3 py-2.5 font-mono text-slate-500">{device.last_ip || '-'}</td>
                                <td className="px-3 py-2.5">
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedDeviceDetail(device)}
                                      className="rounded-lg border border-indigo-200 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50"
                                    >
                                      Detail
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteRfidDevice(device)}
                                      disabled={Boolean(deviceDeletingById[device.id || device.device_id]) || device.template_managed}
                                      title={device.template_managed ? 'Alat default dikelola otomatis' : 'Hapus alat'}
                                      className="inline-flex items-center justify-center rounded-lg border border-rose-200 px-2 py-1 text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {deviceDeletingById[device.id || device.device_id] ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : rfidDevices ? (
                      <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                        Belum ada device RFID terdaftar untuk sekolah ini.
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                        <button
                          type="button"
                          onClick={() => loadRfidDevices(selectedTenantId)}
                          className="text-indigo-600 hover:text-indigo-700 font-semibold"
                        >
                          Klik untuk memuat daftar device
                        </button>
                      </div>
                    )}
                  </div>

                  <section className="rounded-2xl border border-slate-200 p-4 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                          <Router className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">Mosquitto RFID Sekolah</h3>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            Semua alat RFID tenant ini memakai credential Mosquitto platform dan topic per-device.
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] px-2 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                          {detailRfidMqttConfig?.managed_by_platform ? 'Mosquitto platform' : 'Belum diprovision'}
                        </span>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full border ${
                            detailRfidMosquittoActive
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}
                        >
                          {detailRfidMosquittoActive ? 'Aktif' : 'Belum aktif'}
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
                          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                        >
                          {mosquittoProvisioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />}
                          {mosquittoProvisioning ? 'Menyiapkan...' : 'Pakai Mosquitto'}
                        </button>
                        {detailRfidMqttConfig?.managed_by_platform && (
                          <button
                            type="button"
                            onClick={() => handleProvisionMosquitto(true)}
                            disabled={mosquittoProvisioning}
                            className="rounded-full border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                          >
                            Rotasi Password
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase text-slate-500">Host</p>
                        <p className="mt-1 break-all text-sm font-semibold text-slate-900">
                          {detailRfidMosquittoActive ? detailRfidMqttConfig?.host || '-' : '-'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase text-slate-500">Port</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {detailRfidMosquittoActive ? detailRfidMqttConfig?.port || '-' : '-'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase text-slate-500">Username</p>
                        <p className="mt-1 break-all text-sm font-semibold text-slate-900">
                          {detailRfidMosquittoActive ? detailRfidMqttConfig?.username || '-' : '-'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase text-slate-500">TLS</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {detailRfidMosquittoActive && detailRfidMqttConfig?.use_tls ? 'Aktif' : '-'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase text-slate-500">Provider</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {detailRfidMosquittoActive ? 'mosquitto' : '-'}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-slate-700">Topic RFID per Alat</p>
                          <p className="mt-1 text-xs text-slate-500">
                            `{device}` diganti otomatis dengan Device ID yang dipilih saat kode Arduino dibuat.
                          </p>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                          Mosquitto only
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                        {mqttTopicPreview.map((topic) => (
                          <div key={topic.key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <div className="text-[11px] font-semibold uppercase text-slate-500">{topic.label}</div>
                            <div className="mt-1 break-all text-sm font-semibold text-slate-900">{topic.preview}</div>
                            <div className="mt-1 break-all text-[11px] text-slate-500">{topic.template}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>



                </>
              )}

              {detailTab === 'domains' && (
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

              )}

              {detailTab === 'backup' && (
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

                {restorePayload ? (
                  <div className="rounded-xl border border-indigo-200 bg-white p-3">
                    <div className="grid gap-3 text-xs md:grid-cols-4">
                      <div>
                        <p className="text-slate-500">Tenant Asal</p>
                        <p className="mt-1 font-semibold text-slate-900">
                          {restorePayload?.tenant?.name || restorePayload?.tenant?.slug || restorePayload?.tenant?.id || '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Mode Backup</p>
                        <p className="mt-1 font-semibold text-slate-900">
                          {restorePayload?.mode_label || restorePayload?.mode || '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Jumlah Tabel</p>
                        <p className="mt-1 font-semibold text-slate-900">
                          {numberFormatter.format(restorePayloadSummary.tableCount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Total Baris</p>
                        <p className="mt-1 font-semibold text-slate-900">
                          {numberFormatter.format(restorePayloadSummary.totalRows)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {restorePayloadPreviewTables.map((table, index) => (
                        <span
                          key={`${table?.name || table?.table || 'table'}-${index}`}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600"
                        >
                          {table?.name || table?.table || '-'}
                        </span>
                      ))}
                      {restorePayloadSummary.tables.length > restorePayloadPreviewTables.length ? (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
                          +{restorePayloadSummary.tables.length - restorePayloadPreviewTables.length} tabel
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {restorePreview ? (
                  <div className="rounded-xl border border-indigo-200 bg-white p-3 space-y-2">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                      <div className="rounded-lg border border-slate-200 p-2">
                        <p className="text-slate-500">Incoming Rows</p>
                        <p className="font-semibold text-slate-900">
                          {numberFormatter.format(toNumber(restorePreviewSummary?.incoming_rows))}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2">
                        <p className="text-slate-500">{restoreInsertLabel}</p>
                        <p className="font-semibold text-indigo-700">
                          {numberFormatter.format(restoreInsertCount)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2">
                        <p className="text-slate-500">{restoreUpdateLabel}</p>
                        <p className="font-semibold text-indigo-700">
                          {numberFormatter.format(restoreUpdateCount)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2">
                        <p className="text-slate-500">Konflik</p>
                        <p className="font-semibold text-amber-700">
                          {numberFormatter.format(toNumber(restorePreviewSummary?.conflicts))}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2">
                        <p className="text-slate-500">Errors</p>
                        <p className="font-semibold text-rose-700">
                          {numberFormatter.format(toNumber(restorePreviewSummary?.errors))}
                        </p>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="text-left text-slate-500">
                            <th className="py-2 pr-3">Tabel</th>
                            <th className="py-2 pr-3">Incoming</th>
                            <th className="py-2 pr-3">{restoreInsertLabel}</th>
                            <th className="py-2 pr-3">{restoreUpdateLabel}</th>
                            <th className="py-2 pr-3">Konflik</th>
                            <th className="py-2 pr-3">Errors</th>
                          </tr>
                        </thead>
                        <tbody className="text-slate-700">
                          {(restorePreview.tables || []).map((item) => (
                            <tr key={item.table} className="border-t border-slate-100">
                              <td className="py-2 pr-3 font-medium text-slate-900">{item.table}</td>
                              <td className="py-2 pr-3">{numberFormatter.format(toNumber(item.incoming_rows))}</td>
                              <td className="py-2 pr-3">
                                {numberFormatter.format(toNumber(restorePreviewIsApply ? item.inserted || item.would_insert : item.would_insert || item.inserted))}
                              </td>
                              <td className="py-2 pr-3">
                                {numberFormatter.format(toNumber(restorePreviewIsApply ? item.updated || item.would_update : item.would_update || item.updated))}
                              </td>
                              <td className="py-2 pr-3 text-amber-700">{numberFormatter.format(toNumber(item.conflicts))}</td>
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

              )}

              {detailTab === 'admins' && (
                <>
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
        </section>
      )}
      </div>

      {showAddDeviceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowAddDeviceModal(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="border-b border-slate-100 px-6 py-4">
              <h3 className="text-lg font-bold text-slate-900">Tambah Alat RFID</h3>
              <p className="mt-1 text-sm text-slate-500">Daftarkan alat baru untuk sekolah ini.</p>
            </div>
            <form onSubmit={handleAddDeviceSubmit} className="p-6">
              <div className="space-y-4">
                <label className="block space-y-1">
                  <span className="text-sm font-semibold text-slate-700">Device ID</span>
                  <input
                    type="text"
                    required
                    value={addDeviceForm.device_id}
                    onChange={(e) => setAddDeviceForm({ ...addDeviceForm, device_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="edusmart-xxxxx"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-semibold text-slate-700">Nama Alat <span className="font-normal text-slate-400">(opsional)</span></span>
                  <input
                    type="text"
                    value={addDeviceForm.name}
                    onChange={(e) => setAddDeviceForm({ ...addDeviceForm, name: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="Misal: Gerbang Utama"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-sm font-semibold text-slate-700">Board</span>
                    <select
                      value={addDeviceForm.board_type}
                      onChange={(e) => setAddDeviceForm({ ...addDeviceForm, board_type: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    >
                      {RFID_BOARD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-sm font-semibold text-slate-700">Reader</span>
                    <input
                      type="text"
                      value={addDeviceForm.reader_model}
                      onChange={(e) => setAddDeviceForm({ ...addDeviceForm, reader_model: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      placeholder="pn532-spi"
                    />
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="text-sm font-semibold text-slate-700">Lokasi <span className="font-normal text-slate-400">(opsional)</span></span>
                  <input
                    type="text"
                    value={addDeviceForm.location}
                    onChange={(e) => setAddDeviceForm({ ...addDeviceForm, location: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="Misal: Gerbang utara, ruang guru, lab komputer"
                  />
                </label>
              </div>
              <div className="mt-8 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddDeviceModal(false)}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={addDeviceSaving}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {addDeviceSaving ? 'Menyimpan...' : 'Tambah Alat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedDeviceDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setSelectedDeviceDetail(null)} />
          <div className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/80 px-6 py-4 backdrop-blur-md">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Konfigurasi Perangkat</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedDeviceDetail.name || selectedDeviceDetail.device_id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDeviceDetail(null)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {!detailRfidTemplate?.available ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {detailRfidTemplate?.message || 'Template RFID belum tersedia untuk tenant ini.'}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs text-slate-500">Tenant Slug</p>
                      <p className="text-sm font-semibold text-slate-900 mt-1">
                        {detailRfidTemplate.tenant_slug || '-'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs text-slate-500">Device ID</p>
                      <p className="text-sm font-semibold text-slate-900 mt-1 break-all">
                        {selectedDeviceDetail.device_id || '-'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs text-slate-500">Board</p>
                      <p className="text-sm font-semibold text-slate-900 mt-1 break-all">
                        {(selectedDeviceDetail.board_type || 'esp8266').toUpperCase()}
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
                              {selectedDeviceRfidTemplate?.topics?.scan || '-'}
                            </div>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-3 py-2">
                            <div className="text-slate-500">Response</div>
                            <div className="font-semibold text-slate-900 break-all">
                              {selectedDeviceRfidTemplate?.topics?.response || '-'}
                            </div>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-3 py-2">
                            <div className="text-slate-500">Mode</div>
                            <div className="font-semibold text-slate-900 break-all">
                              {selectedDeviceRfidTemplate?.topics?.mode || '-'}
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
                              ? `Template terisi khusus untuk alat ${selectedDeviceDetail.device_id}.`
                              : 'WiFi masih memakai placeholder.'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyRfidArduinoCode}
                          disabled={!deviceArduinoCode}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Salin
                        </button>
                      </div>
                      <pre className="max-h-[34rem] overflow-auto bg-slate-950 text-slate-100 text-[11px] leading-5 p-4 whitespace-pre">
                        {deviceArduinoCode}
                      </pre>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Tenants
