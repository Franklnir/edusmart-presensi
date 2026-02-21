import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useUIStore } from '../../store/useUIStore'
import { loadExcelJsBrowser } from '../../utils/excelBrowser'

const MODE_OPTIONS = [
  {
    value: 'full',
    label: 'Semua Data Sekolah',
    description: 'Backup lengkap semua tabel tenant.'
  },
  {
    value: 'students',
    label: 'Data Siswa',
    description: 'Profil siswa, absensi, tugas, quiz, sertifikat, dan data terkait siswa.'
  },
  {
    value: 'teachers',
    label: 'Data Guru',
    description: 'Profil guru, jadwal, wali kelas, tugas, quiz, dan data terkait guru.'
  },
  {
    value: 'classes',
    label: 'Data Kelas',
    description: 'Master kelas, struktur, siswa, jadwal, absensi, tugas, dan quiz per kelas.'
  }
]

const FORMAT_OPTIONS = [
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'json', label: 'JSON (.json)' },
  { value: 'csv', label: 'CSV Ringkas (.csv)' },
  { value: 'html', label: 'Laporan HTML (.html)' }
]

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, idx) => idx + 1)
const ROW_PREVIEW_LIMIT = 30
const TEXT_PREVIEW_MAX_LINES = 220
const TEXT_PREVIEW_MAX_CHARS = 120000

const toNumber = (value, fallback = 0) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

const toCellValue = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return value
}

const trimPreviewText = (text) => {
  const source = String(text || '')
  const lines = source.split('\n')
  const slicedLines = lines.slice(0, TEXT_PREVIEW_MAX_LINES)
  let joined = slicedLines.join('\n')
  if (joined.length > TEXT_PREVIEW_MAX_CHARS) {
    joined = `${joined.slice(0, TEXT_PREVIEW_MAX_CHARS)}\n...`
  } else if (lines.length > TEXT_PREVIEW_MAX_LINES) {
    joined = `${joined}\n...`
  }
  return joined
}

const getTableColumns = (table, rows) => {
  const fromPayload = Array.isArray(table?.columns) ? table.columns : []
  if (fromPayload.length) {
    return fromPayload
  }

  const keys = []
  const usedKeys = new Set()
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (usedKeys.has(key)) return
      usedKeys.add(key)
      keys.push(key)
    })
  })

  return keys
}

const normalizeFilePart = (value, fallback = 'data') => {
  const safe = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return safe || fallback
}

const buildBaseFileName = (payload, mode) => {
  const tenantName = payload?.tenant?.name || payload?.tenant?.id || 'sekolah'
  const modeSafe = normalizeFilePart(payload?.mode || mode || 'full', 'full')
  const tenantSafe = normalizeFilePart(tenantName, 'sekolah')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `backup-${tenantSafe}-${modeSafe}-${stamp}`
}

const downloadBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

const buildUniqueSheetName = (used, source) => {
  const base = String(source || 'sheet')
    .replace(/[:\\/?*\[\]]/g, ' ')
    .trim() || 'sheet'

  const truncated = base.slice(0, 31)
  if (!used.has(truncated)) {
    used.add(truncated)
    return truncated
  }

  let index = 2
  while (index < 999) {
    const suffix = ` (${index})`
    const candidate = `${base.slice(0, Math.max(0, 31 - suffix.length))}${suffix}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
    index += 1
  }

  return `sheet-${Date.now()}`
}

const applyHeaderStyle = (worksheet, columnCount) => {
  const header = worksheet.getRow(1)
  header.height = 22
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
  const sampleSize = Math.min(rows.length, 100)
  keys.forEach((key, index) => {
    let width = Math.max(12, String(key).length + 2)
    for (let i = 0; i < sampleSize; i += 1) {
      const valueLength = String(toCellValue(rows[i]?.[key])).length + 2
      if (valueLength > width) width = valueLength
      if (width >= 60) break
    }
    worksheet.getColumn(index + 1).width = Math.min(60, width)
  })
}

const createWorkbookBuffer = async (payload) => {
  const ExcelJS = await loadExcelJsBrowser()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'EduSmart Admin'
  workbook.created = new Date()

  const usedSheetNames = new Set()
  const tables = Array.isArray(payload?.tables) ? payload.tables : []
  const summary = payload?.summary || {}

  const summarySheet = workbook.addWorksheet(buildUniqueSheetName(usedSheetNames, 'Ringkasan Backup'))
  summarySheet.columns = [
    { header: 'Field', key: 'field', width: 30 },
    { header: 'Nilai', key: 'value', width: 80 }
  ]
  summarySheet.addRows([
    { field: 'Tenant ID', value: payload?.tenant?.id || '-' },
    { field: 'Nama Sekolah', value: payload?.tenant?.name || '-' },
    { field: 'Mode', value: payload?.mode_label || payload?.mode || '-' },
    { field: 'Periode', value: payload?.period?.label || '-' },
    { field: 'Exported At', value: payload?.exported_at || '-' },
    { field: 'Jumlah Tabel', value: toCellValue(summary?.table_count) },
    { field: 'Jumlah Baris', value: toCellValue(summary?.total_rows) }
  ])
  applyHeaderStyle(summarySheet, 2)
  summarySheet.views = [{ state: 'frozen', ySplit: 1 }]

  const listSheet = workbook.addWorksheet(buildUniqueSheetName(usedSheetNames, 'Daftar Tabel'))
  listSheet.columns = [
    { header: 'No', key: 'no', width: 8 },
    { header: 'Tabel', key: 'table', width: 40 },
    { header: 'Jumlah Kolom', key: 'columns', width: 18 },
    { header: 'Jumlah Baris', key: 'rows', width: 18 }
  ]
  listSheet.addRows(
    tables.map((table, index) => ({
      no: index + 1,
      table: table?.name || '-',
      columns: Number(table?.column_count || (Array.isArray(table?.columns) ? table.columns.length : 0)),
      rows: Number(table?.row_count || (Array.isArray(table?.rows) ? table.rows.length : 0))
    }))
  )
  applyHeaderStyle(listSheet, 4)
  listSheet.views = [{ state: 'frozen', ySplit: 1 }]

  tables.forEach((table) => {
    const rows = Array.isArray(table?.rows) ? table.rows : []
    const worksheet = workbook.addWorksheet(buildUniqueSheetName(usedSheetNames, table?.name || 'Data'))

    if (rows.length === 0) {
      worksheet.columns = [{ header: 'Informasi', key: 'message', width: 60 }]
      worksheet.addRow({ message: 'Tidak ada data' })
      applyHeaderStyle(worksheet, 1)
      return
    }

    const keys = getTableColumns(table, rows)

    worksheet.columns = keys.map((key) => ({ header: key, key }))
    rows.forEach((row) => {
      const item = {}
      keys.forEach((key) => {
        item[key] = toCellValue(row?.[key])
      })
      worksheet.addRow(item)
    })

    applyHeaderStyle(worksheet, keys.length)
    setColumnWidths(worksheet, keys, rows)
    worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  })

  return workbook.xlsx.writeBuffer()
}

const encodeCsvValue = (value) => {
  const text = String(toCellValue(value) ?? '')
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

const createCsvContent = (payload) => {
  const tables = Array.isArray(payload?.tables) ? payload.tables : []
  const lines = []
  const addLine = (cells = []) => {
    lines.push(cells.map((cell) => encodeCsvValue(cell)).join(','))
  }

  addLine(['Ringkasan Backup'])
  addLine(['Field', 'Nilai'])
  addLine(['Tenant ID', payload?.tenant?.id || '-'])
  addLine(['Nama Sekolah', payload?.tenant?.name || '-'])
  addLine(['Mode', payload?.mode_label || payload?.mode || '-'])
  addLine(['Periode', payload?.period?.label || '-'])
  addLine(['Exported At', payload?.exported_at || '-'])
  addLine(['Jumlah Tabel', toNumber(payload?.summary?.table_count)])
  addLine(['Jumlah Baris', toNumber(payload?.summary?.total_rows)])
  addLine([])

  addLine(['Daftar Struktur Tabel'])
  addLine(['No', 'Nama Tabel', 'Jumlah Kolom', 'Jumlah Baris'])
  tables.forEach((table, index) => {
    addLine([
      index + 1,
      table?.name || '-',
      toNumber(table?.column_count || (Array.isArray(table?.columns) ? table.columns.length : 0)),
      toNumber(table?.row_count || (Array.isArray(table?.rows) ? table.rows.length : 0))
    ])
  })
  addLine([])

  tables.forEach((table) => {
    const rows = Array.isArray(table?.rows) ? table.rows : []
    const columns = getTableColumns(table, rows)

    addLine([`Tabel: ${table?.name || '-'}`])
    if (!rows.length) {
      addLine(['Tidak ada data'])
      addLine([])
      return
    }

    addLine(columns)
    rows.forEach((row) => {
      addLine(columns.map((key) => row?.[key]))
    })
    addLine([])
  })

  return lines.join('\n')
}

const escapeHtml = (value) => {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const createHtmlContent = (payload) => {
  const tables = Array.isArray(payload?.tables) ? payload.tables : []
  const sections = tables
    .map((table) => {
      const rows = Array.isArray(table?.rows) ? table.rows : []
      if (!rows.length) {
        return `
          <section class="section">
            <h3>${escapeHtml(table?.name || '-')}</h3>
            <p>Tidak ada data.</p>
          </section>
        `
      }

      const keys = getTableColumns(table, rows)

      const header = keys.map((key) => `<th>${escapeHtml(key)}</th>`).join('')
      const body = rows
        .map((row) => `<tr>${keys.map((key) => `<td>${escapeHtml(toCellValue(row?.[key]))}</td>`).join('')}</tr>`)
        .join('')

      return `
        <section class="section">
          <h3>${escapeHtml(table?.name || '-')} <small>(${rows.length} baris)</small></h3>
          <div class="table-wrap">
            <table>
              <thead><tr>${header}</tr></thead>
              <tbody>${body}</tbody>
            </table>
          </div>
        </section>
      `
    })
    .join('\n')

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Backup ${escapeHtml(payload?.tenant?.name || '')}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; background: #f8fafc; }
    .card { background: #fff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap: 8px 16px; }
    .label { color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .value { font-weight: 600; }
    .section { background: #fff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px; margin-bottom: 12px; }
    .section h3 { margin: 0 0 8px; font-size: 16px; }
    .table-wrap { overflow: auto; max-width: 100%; border: 1px solid #e2e8f0; border-radius: 8px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #e2e8f0; position: sticky; top: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Backup Data Sekolah</h1>
    <div class="grid">
      <div><div class="label">Tenant</div><div class="value">${escapeHtml(payload?.tenant?.name || '-')}</div></div>
      <div><div class="label">Tenant ID</div><div class="value">${escapeHtml(payload?.tenant?.id || '-')}</div></div>
      <div><div class="label">Mode</div><div class="value">${escapeHtml(payload?.mode_label || payload?.mode || '-')}</div></div>
      <div><div class="label">Periode</div><div class="value">${escapeHtml(payload?.period?.label || '-')}</div></div>
      <div><div class="label">Jumlah Tabel</div><div class="value">${escapeHtml(payload?.summary?.table_count ?? '-')}</div></div>
      <div><div class="label">Jumlah Baris</div><div class="value">${escapeHtml(payload?.summary?.total_rows ?? '-')}</div></div>
      <div><div class="label">Exported At</div><div class="value">${escapeHtml(payload?.exported_at || '-')}</div></div>
    </div>
  </div>
  ${sections}
</body>
</html>`
}

export default function BackupAdmin() {
  const { pushToast } = useUIStore()

  const [mode, setMode] = useState('full')
  const [periodType, setPeriodType] = useState('all')
  const [months, setMonths] = useState(12)
  const [format, setFormat] = useState('xlsx')
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [payload, setPayload] = useState(null)
  const [payloadQueryKey, setPayloadQueryKey] = useState('')
  const [tableSearch, setTableSearch] = useState('')
  const [selectedTableKey, setSelectedTableKey] = useState('')
  const [restorePayload, setRestorePayload] = useState(null)
  const [restoreFileName, setRestoreFileName] = useState('')
  const [restoreResult, setRestoreResult] = useState(null)
  const [restorePreviewLoading, setRestorePreviewLoading] = useState(false)
  const [restoreApplyLoading, setRestoreApplyLoading] = useState(false)
  const [restoreIncludeTables, setRestoreIncludeTables] = useState('')

  const resolvedMonths = useMemo(() => {
    if (periodType === 'all') return null
    if (periodType === 'this_month') return 1
    return Math.max(1, Math.min(12, Number(months) || 1))
  }, [periodType, months])

  const queryKey = useMemo(
    () => `${mode}|${resolvedMonths === null ? 'all' : resolvedMonths}`,
    [mode, resolvedMonths]
  )

  const loadBackupPayload = async ({ silent = false } = {}) => {
    setLoading(true)
    try {
      const { data, error } = await supabase.admin.backup({
        mode,
        months: resolvedMonths || undefined
      })

      if (error) throw error
      if (!data || !Array.isArray(data.tables)) {
        throw new Error('Format data backup tidak valid')
      }

      setPayload(data)
      setPayloadQueryKey(queryKey)
      if (!silent) {
        pushToast('success', 'Preview backup berhasil dibuat')
      }
      return data
    } catch (err) {
      pushToast('error', err?.message || 'Gagal membuat preview backup')
      return null
    } finally {
      setLoading(false)
    }
  }

  const exportBackup = async (activePayload) => {
    if (!activePayload) return

    setDownloading(true)
    try {
      const baseName = buildBaseFileName(activePayload, mode)

      if (format === 'xlsx') {
        const buffer = await createWorkbookBuffer(activePayload)
        downloadBlob(
          new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
          `${baseName}.xlsx`
        )
      } else if (format === 'json') {
        const json = JSON.stringify(activePayload, null, 2)
        downloadBlob(new Blob([json], { type: 'application/json' }), `${baseName}.json`)
      } else if (format === 'csv') {
        const csv = createCsvContent(activePayload)
        downloadBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }), `${baseName}.csv`)
      } else if (format === 'html') {
        const html = createHtmlContent(activePayload)
        downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8;' }), `${baseName}.html`)
      }

      pushToast('success', 'Backup berhasil diunduh')
    } catch (err) {
      pushToast('error', err?.message || 'Gagal mengekspor backup')
    } finally {
      setDownloading(false)
    }
  }

  const handlePreview = async () => {
    await loadBackupPayload()
  }

  const handleDownload = async () => {
    const activePayload = !payload || payloadQueryKey !== queryKey
      ? await loadBackupPayload({ silent: Boolean(payload) })
      : payload
    if (!activePayload) return
    await exportBackup(activePayload)
  }

  const parseRestoreIncludeTables = () =>
    restoreIncludeTables
      .split(/[,;\n\r]+/g)
      .map((item) => item.trim())
      .filter(Boolean)

  const handleRestoreFileChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (!parsed || !Array.isArray(parsed.tables)) {
        throw new Error('File JSON backup tidak valid (tables tidak ditemukan)')
      }
      setRestorePayload(parsed)
      setRestoreFileName(file.name || 'backup.json')
      setRestoreResult(null)
      pushToast('success', `File restore siap: ${file.name}`)
    } catch (err) {
      setRestorePayload(null)
      setRestoreFileName('')
      setRestoreResult(null)
      pushToast('error', err?.message || 'Gagal membaca file restore')
    } finally {
      event.target.value = ''
    }
  }

  const handleRestorePreview = async () => {
    if (!restorePayload || restorePreviewLoading || restoreApplyLoading) return

    setRestorePreviewLoading(true)
    try {
      const includeTables = parseRestoreIncludeTables()
      const { data, error } = await supabase.admin.restoreBackup({
        backup: restorePayload,
        dry_run: true,
        include_tables: includeTables.length ? includeTables : undefined
      })
      if (error) throw error
      setRestoreResult(data?.result || null)
      pushToast('success', 'Dry-run restore selesai. Silakan cek hasil preview.')
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menjalankan dry-run restore')
    } finally {
      setRestorePreviewLoading(false)
    }
  }

  const handleRestoreApply = async () => {
    if (!restorePayload || restoreApplyLoading || restorePreviewLoading) return
    const confirmed = window.confirm(
      'Apply restore ke tenant ini sekarang? Data akan diproses sesuai payload backup.'
    )
    if (!confirmed) return

    setRestoreApplyLoading(true)
    try {
      const includeTables = parseRestoreIncludeTables()
      const { data, error } = await supabase.admin.restoreBackup({
        backup: restorePayload,
        dry_run: false,
        confirm: true,
        include_tables: includeTables.length ? includeTables : undefined
      })
      if (error) throw error
      setRestoreResult(data?.result || null)
      pushToast('success', 'Restore berhasil diterapkan.')
    } catch (err) {
      pushToast('error', err?.message || 'Gagal apply restore')
    } finally {
      setRestoreApplyLoading(false)
    }
  }

  const tables = useMemo(() => {
    if (!Array.isArray(payload?.tables)) return []
    return payload.tables.map((table, index) => ({
      ...table,
      _key: `${table?.name || 'table'}-${index}`
    }))
  }, [payload])

  const filteredTables = useMemo(() => {
    const query = tableSearch.trim().toLowerCase()
    if (!query) return tables
    return tables.filter((table) => String(table?.name || '').toLowerCase().includes(query))
  }, [tables, tableSearch])

  useEffect(() => {
    if (!filteredTables.length) {
      if (selectedTableKey) setSelectedTableKey('')
      return
    }

    const hasSelected = filteredTables.some((table) => table._key === selectedTableKey)
    if (!hasSelected) {
      setSelectedTableKey(filteredTables[0]._key)
    }
  }, [filteredTables, selectedTableKey])

  const selectedTable = useMemo(
    () => filteredTables.find((table) => table._key === selectedTableKey) || null,
    [filteredTables, selectedTableKey]
  )

  const selectedRows = Array.isArray(selectedTable?.rows) ? selectedTable.rows : []
  const selectedColumns = getTableColumns(selectedTable, selectedRows)
  const previewRows = selectedRows.slice(0, ROW_PREVIEW_LIMIT)
  const isPreviewStale = Boolean(payload && payloadQueryKey !== queryKey)
  const selectedFormatLabel = FORMAT_OPTIONS.find((item) => item.value === format)?.label || format

  const formatPreview = useMemo(() => {
    if (!payload) {
      return { text: '', html: '' }
    }

    if (format === 'json') {
      return { text: trimPreviewText(JSON.stringify(payload, null, 2)), html: '' }
    }

    if (format === 'csv') {
      return { text: trimPreviewText(createCsvContent(payload)), html: '' }
    }

    if (format === 'html') {
      return { text: '', html: createHtmlContent(payload) }
    }

    return { text: '', html: '' }
  }, [payload, format])

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-6">
      <div className="w-full space-y-8 px-4 sm:px-6 lg:px-8">
        <section className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <span className="text-2xl text-blue-600">🗄️</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-1">Backup Data Sekolah</h1>
                <p className="text-gray-600">
                  Pilih jenis data yang ingin dibackup, tentukan periode bulan, lalu unduh dalam format yang dibutuhkan.
                </p>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              Format: Excel, JSON, CSV, HTML
            </div>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-2xl p-6 shadow-lg space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Jenis Backup</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              {MODE_OPTIONS.map((item) => {
                const active = item.value === mode
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setMode(item.value)}
                    className={`text-left rounded-xl border px-4 py-3 transition-all ${
                      active
                        ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                        : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-semibold text-slate-900">{item.label}</div>
                    <div className="text-xs text-slate-600 mt-1">{item.description}</div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Periode Backup</label>
              <select
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="all">Semua Data</option>
                <option value="this_month">Bulan Ini</option>
                <option value="custom">1-12 Bulan Terakhir</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Jumlah Bulan</label>
              <select
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
                disabled={periodType !== 'custom'}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-100 disabled:text-slate-400"
              >
                {MONTH_OPTIONS.map((monthValue) => (
                  <option key={monthValue} value={monthValue}>
                    {monthValue} bulan
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Format Export</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                {FORMAT_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={handlePreview}
              disabled={loading || downloading}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? 'Membuat Preview...' : 'Preview Backup'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={loading || downloading}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {downloading ? 'Menyiapkan File...' : 'Backup & Download'}
            </button>
          </div>

          <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Restore Backup (Maker-Checker tetap berlaku)</h3>
              {restoreFileName ? (
                <span className="text-xs px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200">
                  File: {restoreFileName}
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Upload File JSON</label>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={handleRestoreFileChange}
                  className="block w-full text-xs text-slate-600 file:mr-2 file:rounded-full file:border-0 file:bg-indigo-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-indigo-700 hover:file:bg-indigo-200"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Include Tabel (opsional)
                </label>
                <input
                  type="text"
                  value={restoreIncludeTables}
                  onChange={(event) => setRestoreIncludeTables(event.target.value)}
                  placeholder="contoh: profiles,kelas,jadwal"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={handleRestorePreview}
                  disabled={!restorePayload || restorePreviewLoading || restoreApplyLoading}
                  className="px-3 py-2 rounded-lg border border-indigo-200 text-indigo-700 text-xs hover:bg-indigo-50 disabled:opacity-60"
                >
                  {restorePreviewLoading ? 'Dry-Run...' : 'Preview Dry-Run'}
                </button>
                <button
                  type="button"
                  onClick={handleRestoreApply}
                  disabled={!restorePayload || restoreApplyLoading || restorePreviewLoading}
                  className="px-3 py-2 rounded-lg border border-rose-200 text-rose-700 text-xs hover:bg-rose-50 disabled:opacity-60"
                >
                  {restoreApplyLoading ? 'Applying...' : 'Apply Restore'}
                </button>
              </div>
            </div>

            {restoreResult ? (
              <div className="rounded-lg border border-indigo-200 bg-white p-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="rounded-md border border-slate-200 p-2">
                    <p className="text-slate-500">Incoming</p>
                    <p className="font-semibold text-slate-900">{toNumber(restoreResult?.summary?.incoming_rows)}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 p-2">
                    <p className="text-slate-500">Would Insert</p>
                    <p className="font-semibold text-indigo-700">{toNumber(restoreResult?.summary?.would_insert)}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 p-2">
                    <p className="text-slate-500">Would Update</p>
                    <p className="font-semibold text-indigo-700">{toNumber(restoreResult?.summary?.would_update)}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 p-2">
                    <p className="text-slate-500">Errors</p>
                    <p className="font-semibold text-rose-700">{toNumber(restoreResult?.summary?.errors)}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Jalankan dry-run terlebih dahulu untuk memastikan restore aman sebelum apply.
              </p>
            )}
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-2xl p-6 shadow-lg">
          <h2 className="text-base font-semibold text-slate-900 mb-3">Ringkasan Backup</h2>

          {isPreviewStale && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Parameter backup berubah. Preview ini belum sesuai pilihan terbaru, dan akan diperbarui otomatis saat download.
            </div>
          )}

          {!payload ? (
            <div className="text-sm text-slate-500">
              Belum ada preview. Klik <strong>Preview Backup</strong> untuk melihat struktur data yang akan diekspor.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2">
                  <div className="text-xs text-indigo-700">Tenant</div>
                  <div className="font-semibold text-indigo-900">{payload?.tenant?.name || '-'}</div>
                </div>
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2">
                  <div className="text-xs text-indigo-700">Mode</div>
                  <div className="font-semibold text-indigo-900">{payload?.mode_label || payload?.mode || '-'}</div>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                  <div className="text-xs text-emerald-700">Periode</div>
                  <div className="font-semibold text-emerald-900">{payload?.period?.label || '-'}</div>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
                  <div className="text-xs text-amber-700">Jumlah Tabel</div>
                  <div className="font-semibold text-amber-900">{toNumber(payload?.summary?.table_count)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-600">Total Baris</div>
                  <div className="font-semibold text-slate-900">{toNumber(payload?.summary?.total_rows)}</div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700">
                  Preview Sesuai Format: {selectedFormatLabel}
                </div>

                {format === 'html' ? (
                  <iframe
                    title="Preview HTML Backup"
                    srcDoc={formatPreview.html}
                    className="w-full h-[460px] bg-white"
                  />
                ) : format === 'json' || format === 'csv' ? (
                  <pre className="max-h-[460px] overflow-auto p-3 text-xs leading-5 bg-white text-slate-800 whitespace-pre-wrap">
                    {formatPreview.text || 'Tidak ada data preview.'}
                  </pre>
                ) : (
                  <div className="space-y-4 p-3">
                    <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                      Format Excel tidak bisa dirender 1:1 di browser. Preview di bawah menampilkan struktur data yang akan diisi ke sheet Excel.
                    </div>

                    <div className="rounded-xl border border-slate-200">
                      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
                        <div className="text-sm font-semibold text-slate-700">Daftar Struktur Tabel Backup</div>
                        <input
                          type="text"
                          value={tableSearch}
                          onChange={(event) => setTableSearch(event.target.value)}
                          placeholder="Cari nama tabel..."
                          className="w-full md:w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      <div className="max-h-[320px] overflow-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-white">
                            <tr className="border-b border-slate-200">
                              <th className="text-left px-3 py-2 w-16">No</th>
                              <th className="text-left px-3 py-2">Nama Tabel</th>
                              <th className="text-right px-3 py-2 w-36">Jumlah Kolom</th>
                              <th className="text-right px-3 py-2 w-36">Jumlah Baris</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredTables.length ? (
                              filteredTables.map((table, index) => {
                                const selected = table._key === selectedTableKey
                                return (
                                  <tr
                                    key={table._key}
                                    onClick={() => setSelectedTableKey(table._key)}
                                    className={`border-b border-slate-100 cursor-pointer ${
                                      selected ? 'bg-indigo-50' : 'hover:bg-slate-50'
                                    }`}
                                  >
                                    <td className="px-3 py-2 text-slate-500">{index + 1}</td>
                                    <td className="px-3 py-2 text-slate-800">{table?.name || '-'}</td>
                                    <td className="px-3 py-2 text-right font-medium text-slate-700">
                                      {toNumber(table?.column_count || (Array.isArray(table?.columns) ? table.columns.length : 0))}
                                    </td>
                                    <td className="px-3 py-2 text-right font-medium text-slate-700">
                                      {toNumber(table?.row_count || (Array.isArray(table?.rows) ? table.rows.length : 0))}
                                    </td>
                                  </tr>
                                )
                              })
                            ) : (
                              <tr>
                                <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                                  Tidak ada tabel yang cocok dengan pencarian.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700">
                        Preview Isi Tabel
                      </div>
                      {!selectedTable ? (
                        <div className="px-3 py-4 text-sm text-slate-500">Pilih tabel di atas untuk melihat detail.</div>
                      ) : (
                        <div className="space-y-3 p-3">
                          <div className="text-sm text-slate-700">
                            <span className="font-semibold">{selectedTable?.name || '-'}</span>
                            {' • '}
                            {toNumber(selectedTable?.column_count || selectedColumns.length)} kolom
                            {' • '}
                            {toNumber(selectedTable?.row_count || selectedRows.length)} baris
                          </div>
                          <div className="max-h-[320px] overflow-auto rounded-lg border border-slate-200">
                            <table className="w-full text-sm">
                              <thead className="sticky top-0 bg-white">
                                <tr className="border-b border-slate-200">
                                  {selectedColumns.map((column) => (
                                    <th key={column} className="text-left px-3 py-2 whitespace-nowrap">
                                      {column}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {previewRows.length ? (
                                  previewRows.map((row, rowIndex) => (
                                    <tr key={`${selectedTable._key}-row-${rowIndex}`} className="border-b border-slate-100">
                                      {selectedColumns.map((column) => (
                                        <td key={`${selectedTable._key}-${rowIndex}-${column}`} className="px-3 py-2 text-slate-700 align-top">
                                          {String(toCellValue(row?.[column])) || '-'}
                                        </td>
                                      ))}
                                    </tr>
                                  ))
                                ) : (
                                  <tr>
                                    <td colSpan={Math.max(1, selectedColumns.length)} className="px-3 py-4 text-center text-slate-500">
                                      Tidak ada data pada tabel ini.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          {selectedRows.length > ROW_PREVIEW_LIMIT && (
                            <div className="text-xs text-slate-500">
                              Menampilkan {ROW_PREVIEW_LIMIT} dari {selectedRows.length} baris. Data lengkap tetap ikut saat export.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
