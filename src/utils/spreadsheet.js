import { loadExcelJsBrowser } from './excelBrowser'
import { loadSheetJsBrowser } from './sheetjsBrowser'

const DEFAULT_SHEET_NAME = 'Sheet1'
export const SPREADSHEET_IMPORT_ACCEPT = '.xlsx,.xls,.xlsm,.xlsb,.ods,.fods,.xml,.csv,.tsv,.txt,.html,.htm'
export const SPREADSHEET_IMPORT_FORMAT_LABEL = '.xlsx, .xls, .xlsm, .xlsb, .ods, .csv, .tsv, .txt, atau tabel HTML'

const pad2 = (value) => String(value).padStart(2, '0')

const isEmptyValue = (value) => value === null || value === undefined || String(value).trim() === ''

const normalizeCellValue = (value) => {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value

  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part?.text || '').join('')
    }

    if (Object.prototype.hasOwnProperty.call(value, 'result')) {
      return normalizeCellValue(value.result)
    }

    if (Object.prototype.hasOwnProperty.call(value, 'text')) {
      return String(value.text || '')
    }

    if (Object.prototype.hasOwnProperty.call(value, 'hyperlink')) {
      return String(value.text || value.hyperlink || '')
    }

    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  return value
}

const detectCsvDelimiter = (csvText) => {
  const firstLine = String(csvText || '')
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)

  if (!firstLine) return ','

  const commaCount = (firstLine.match(/,/g) || []).length
  const semicolonCount = (firstLine.match(/;/g) || []).length
  const tabCount = (firstLine.match(/\t/g) || []).length

  if (tabCount > commaCount && tabCount > semicolonCount) return '\t'
  return semicolonCount > commaCount ? ';' : ','
}

const parseCsvMatrix = (csvText, delimiter) => {
  const rows = []
  let currentRow = []
  let currentCell = ''
  let inQuotes = false

  const text = String(csvText || '')

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const nextChar = text[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === delimiter) {
      currentRow.push(currentCell)
      currentCell = ''
      continue
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && nextChar === '\n') {
        i += 1
      }
      currentRow.push(currentCell)
      rows.push(currentRow)
      currentRow = []
      currentCell = ''
      continue
    }

    currentCell += char
  }

  currentRow.push(currentCell)
  rows.push(currentRow)

  while (rows.length > 0) {
    const tail = rows[rows.length - 1]
    if (!tail || tail.every((cell) => String(cell || '').trim() === '')) {
      rows.pop()
      continue
    }
    break
  }

  return rows
}

const buildUniqueHeaders = (rawHeaders = []) => {
  const used = new Map()

  return rawHeaders.map((header, index) => {
    const base = String(header || '').trim() || `kolom_${index + 1}`
    const key = base.toLowerCase()
    const count = used.get(key) || 0
    used.set(key, count + 1)
    return count === 0 ? base : `${base}_${count + 1}`
  })
}

export const parseExcelSerialDate = (serialValue) => {
  const serial = Number(serialValue)
  if (!Number.isFinite(serial)) return ''

  // Excel date serial: 1 = 1899-12-31, with the 1900 leap-year bug preserved.
  const epoch = Date.UTC(1899, 11, 30)
  const ms = Math.round(serial * 24 * 60 * 60 * 1000)
  const date = new Date(epoch + ms)
  if (Number.isNaN(date.getTime())) return ''

  const year = date.getUTCFullYear()
  const month = pad2(date.getUTCMonth() + 1)
  const day = pad2(date.getUTCDate())
  return `${year}-${month}-${day}`
}

export const readRowsFromCsvText = (csvText) => {
  const delimiter = detectCsvDelimiter(csvText)
  const matrix = parseCsvMatrix(csvText, delimiter)
  return matrixToRows(matrix)
}

const matrixToRows = (matrix = []) => {
  if (!matrix.length) return []

  const headers = buildUniqueHeaders(matrix[0])
  const rows = []

  for (let rowIdx = 1; rowIdx < matrix.length; rowIdx += 1) {
    const sourceRow = matrix[rowIdx] || []
    const hasData = sourceRow.some((cell) => !isEmptyValue(cell))
    if (!hasData) continue

    const row = {}
    headers.forEach((header, colIdx) => {
      row[header] = sourceRow[colIdx] ?? ''
    })
    rows.push(row)
  }

  return rows
}

const decodeBufferText = (buffer) => {
  try {
    return new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '')
  } catch {
    return ''
  }
}

const isZipBuffer = (buffer) => {
  const bytes = new Uint8Array(buffer.slice(0, 4))
  return bytes[0] === 0x50 && bytes[1] === 0x4b
}

const isOldExcelBuffer = (buffer) => {
  const bytes = new Uint8Array(buffer.slice(0, 8))
  return (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  )
}

const isLikelyTextBuffer = (buffer) => {
  const bytes = new Uint8Array(buffer.slice(0, Math.min(buffer.byteLength, 4096)))
  if (!bytes.length) return false

  let controlCount = 0
  for (const byte of bytes) {
    const allowedControl = byte === 0x09 || byte === 0x0a || byte === 0x0d
    if (byte < 0x20 && !allowedControl) controlCount += 1
  }

  return controlCount / bytes.length < 0.02
}

const looksLikeHtml = (text) => /^(\s|\uFEFF)*(<!doctype\s+html|<html|<head|<body|<table)\b/i.test(text)

const htmlTableToRows = (htmlText) => {
  if (typeof DOMParser === 'undefined') return []

  const doc = new DOMParser().parseFromString(htmlText, 'text/html')
  const table = doc.querySelector('table')
  if (!table) return []

  const matrix = Array.from(table.querySelectorAll('tr'))
    .map((tr) => Array.from(tr.querySelectorAll('th,td')).map((cell) => cell.textContent?.trim() || ''))
    .filter((row) => row.some((cell) => !isEmptyValue(cell)))

  return matrixToRows(matrix)
}

const readRowsFromTextSpreadsheet = (text) => {
  if (looksLikeHtml(text)) {
    const rows = htmlTableToRows(text)
    if (rows.length) return rows
    throw new Error('File yang diupload terlihat seperti halaman web/HTML, bukan Excel valid. Unduh ulang sebagai .xlsx atau .csv.')
  }

  return readRowsFromCsvText(text)
}

const excelReadErrorMessage = (error) => {
  const message = String(error?.message || '')
  if (/password|encrypted/i.test(message)) {
    return 'File Excel terkunci password atau terenkripsi. Buka file, hilangkan proteksi/password, lalu simpan ulang sebagai .xlsx.'
  }
  if (/sheets|workbook|zip|central directory|invalid/i.test(message)) {
    return 'File Excel tidak valid atau belum didukung. Buka file lalu Save As sebagai Excel Workbook (.xlsx), bukan .xls/Strict Open XML, atau simpan sebagai .csv.'
  }

  return 'File Excel tidak bisa dibaca. Pastikan formatnya .xlsx atau .csv yang valid.'
}

const sheetJsReadErrorMessage = (error) => {
  const message = String(error?.message || '')
  if (/password|encrypted/i.test(message)) {
    return 'File spreadsheet terkunci password atau terenkripsi. Buka file, hilangkan proteksi/password, lalu upload ulang.'
  }

  return 'File spreadsheet tidak bisa dibaca. Pastikan file tidak rusak dan formatnya termasuk format spreadsheet yang didukung.'
}

const worksheetToRows = (worksheet) => {
  if (!worksheet) return []

  let maxColumn = Math.max(worksheet.columnCount || 0, 1)
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    maxColumn = Math.max(maxColumn, row.actualCellCount || 0, row.cellCount || 0)
  })

  let headerRowIndex = 0
  let headers = []

  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const values = []
    for (let col = 1; col <= maxColumn; col += 1) {
      values.push(normalizeCellValue(row.getCell(col).value))
    }

    if (!values.some((value) => !isEmptyValue(value))) continue

    headerRowIndex = rowNumber
    headers = buildUniqueHeaders(values)
    break
  }

  if (!headerRowIndex || !headers.length) return []

  const out = []
  for (let rowNumber = headerRowIndex + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const rowObj = {}
    let hasData = false

    for (let col = 1; col <= headers.length; col += 1) {
      const value = normalizeCellValue(row.getCell(col).value)
      if (!isEmptyValue(value)) hasData = true
      rowObj[headers[col - 1]] = value
    }

    if (!hasData) continue
    out.push(rowObj)
  }

  return out
}

const excelJsWorkbookToRows = (workbook) => {
  const worksheets = workbook?.worksheets || []
  for (const worksheet of worksheets) {
    const rows = worksheetToRows(worksheet)
    if (rows.length) return rows
  }

  return []
}

const sheetJsWorksheetToRows = (worksheet, XLSX) => {
  if (!worksheet) return []

  const matrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  })

  return matrixToRows(matrix)
}

const sheetJsWorkbookToRows = (workbook, XLSX) => {
  const sheetNames = workbook?.SheetNames || []
  for (const sheetName of sheetNames) {
    const rows = sheetJsWorksheetToRows(workbook.Sheets?.[sheetName], XLSX)
    if (rows.length) return rows
  }

  return []
}

const readRowsWithSheetJs = async (buffer) => {
  const XLSX = await loadSheetJsBrowser()
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
  })

  return sheetJsWorkbookToRows(workbook, XLSX)
}

export const readRowsFromSpreadsheetFile = async (file) => {
  const name = String(file?.name || '').toLowerCase()

  if (name.endsWith('.csv') || String(file?.type || '').includes('csv')) {
    const text = await file.text()
    return readRowsFromCsvText(text)
  }

  const buffer = await file.arrayBuffer()
  if (!buffer.byteLength) {
    throw new Error('File kosong. Upload file .xlsx atau .csv yang sudah berisi data.')
  }

  if (!isZipBuffer(buffer)) {
    if (isLikelyTextBuffer(buffer)) {
      const text = decodeBufferText(buffer)
      if (looksLikeHtml(text)) {
        return readRowsFromTextSpreadsheet(text)
      }

      try {
        const rows = await readRowsWithSheetJs(buffer)
        if (rows.length) return rows
      } catch { }

      return readRowsFromTextSpreadsheet(text)
    }

    try {
      return await readRowsWithSheetJs(buffer)
    } catch (error) {
      if (isOldExcelBuffer(buffer) || (name.endsWith('.xls') && !name.endsWith('.xlsx'))) {
        throw new Error('File Excel .xls lama tidak berhasil dibaca. Pastikan file tidak rusak atau export ulang sebagai .xlsx/.csv.')
      }
      throw new Error(sheetJsReadErrorMessage(error))
    }
  }

  const ExcelJS = await loadExcelJsBrowser()
  const workbook = new ExcelJS.Workbook()

  try {
    await workbook.xlsx.load(buffer)
  } catch (error) {
    try {
      return await readRowsWithSheetJs(buffer)
    } catch {
      throw new Error(excelReadErrorMessage(error))
    }
  }

  const rows = excelJsWorkbookToRows(workbook)
  if (rows.length) {
    return rows
  }

  try {
    const fallbackRows = await readRowsWithSheetJs(buffer)
    if (fallbackRows.length) return fallbackRows
  } catch { }

  throw new Error('Sheet berisi data tidak ditemukan. Pastikan file memiliki minimal 1 sheet yang berisi header dan data.')
}

const toCellText = (value) => {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = pad2(value.getMonth() + 1)
    const day = pad2(value.getDate())
    return `${year}-${month}-${day}`
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

const calcColumnWidths = (rows, keys) =>
  keys.map((key) => {
    let width = Math.max(12, String(key).length + 2)
    const sampleSize = Math.min(rows.length, 200)
    for (let i = 0; i < sampleSize; i += 1) {
      const len = toCellText(rows[i]?.[key]).length + 2
      if (len > width) width = len
      if (width >= 60) break
    }
    return Math.min(60, width)
  })

export const exportRowsToExcel = async ({
  rows = [],
  fileName = 'export.xlsx',
  sheetName = DEFAULT_SHEET_NAME
}) => {
  const ExcelJS = await loadExcelJsBrowser()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'EduSmart'
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet(String(sheetName || DEFAULT_SHEET_NAME).slice(0, 31))
  const safeRows = Array.isArray(rows) ? rows : []

  if (!safeRows.length) {
    worksheet.columns = [{ header: 'Informasi', key: 'info', width: 50 }]
    worksheet.addRow({ info: 'Tidak ada data untuk diekspor' })
  } else {
    const keys = []
    const keySet = new Set()
    safeRows.forEach((row) => {
      Object.keys(row || {}).forEach((key) => {
        if (keySet.has(key)) return
        keySet.add(key)
        keys.push(key)
      })
    })

    const widths = calcColumnWidths(safeRows, keys)
    worksheet.columns = keys.map((key, index) => ({
      header: key,
      key,
      width: widths[index]
    }))

    safeRows.forEach((row) => {
      const normalized = {}
      keys.forEach((key) => {
        normalized[key] = toCellText(row?.[key])
      })
      worksheet.addRow(normalized)
    })
  }

  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FF0F172A' } }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' }
  }
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
