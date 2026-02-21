import { loadExcelJsBrowser } from './excelBrowser'

const DEFAULT_SHEET_NAME = 'Sheet1'

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

export const readRowsFromSpreadsheetFile = async (file) => {
  const name = String(file?.name || '').toLowerCase()

  if (name.endsWith('.csv') || String(file?.type || '').includes('csv')) {
    const text = await file.text()
    return readRowsFromCsvText(text)
  }

  const buffer = await file.arrayBuffer()
  const ExcelJS = await loadExcelJsBrowser()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const worksheet = workbook.worksheets[0]
  return worksheetToRows(worksheet)
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
