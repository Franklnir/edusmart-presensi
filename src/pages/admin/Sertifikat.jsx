// src/pages/admin/Sertifikat.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  supabase,
  apiFetch,
  CERT_BUCKET as APP_CERT_BUCKET,
  CERT_TEMPLATE_BUCKET as APP_CERT_TEMPLATE_BUCKET,
  extractObjectPath
} from '../../lib/supabase'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { resolveAcademicPeriod } from '../../utils/academicPeriod'
import { List } from 'react-window'

// ================== KONFIGURASI BUCKET ==================
const CERT_BUCKET = APP_CERT_BUCKET
const CERT_TEMPLATE_BUCKET = APP_CERT_TEMPLATE_BUCKET
const CERT_BUCKET_FALLBACKS = Array.from(new Set([CERT_BUCKET, 'sertifikat-files']))
const CERT_TEMPLATE_BUCKET_FALLBACKS = Array.from(new Set([CERT_TEMPLATE_BUCKET, 'sertifikat-templates']))
const SETTINGS_PERIOD_COLUMNS = 'tahun_ajaran, semester_aktif, periode_mulai, periode_selesai, periode_ganjil_mulai, periode_ganjil_selesai, periode_genap_mulai, periode_genap_selesai'

const loadCurrentAcademicPeriod = async () => {
  const { data } = await supabase
    .from('settings')
    .select(SETTINGS_PERIOD_COLUMNS)
    .order('id')
    .limit(1)
    .maybeSingle()

  return resolveAcademicPeriod(data || {})
}

const applyAcademicSemesterFilter = (query, period) => {
  let next = query
  if (period?.tahunAjaran) next = next.eq('tahun_ajaran', period.tahunAjaran)
  if (period?.semester) next = next.eq('semester', period.semester)
  return next
}

// A4 landscape size (points)
const A4_WIDTH = 842
const A4_HEIGHT = 595

// Signed URL expiry (seconds)
const SIGNED_EXPIRES = 60 * 60 * 24 * 7 // 7 hari

const TEMPLATE_UPLOAD_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp'
const TEMPLATE_ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp']
const OUTPUT_FORMATS = [
  { value: 'pdf', label: 'PDF', extension: 'pdf', contentType: 'application/pdf' },
  { value: 'png', label: 'PNG', extension: 'png', contentType: 'image/png' },
  { value: 'jpg', label: 'JPG', extension: 'jpg', contentType: 'image/jpeg' }
]
const IMAGE_OUTPUT_SCALE = 2

function CertificateParticipantRow({
  index,
  style,
  ariaAttributes,
  items,
  selectedIds,
  onToggle
}) {
  const p = items[index] || {}
  const id = p.id || ''

  return (
    <div
      style={style}
      {...ariaAttributes}
      className={`flex items-center border-b border-gray-100 transition-colors hover:bg-blue-50/60 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
    >
      <div className="w-12 flex-shrink-0 border-r p-3 text-center">
        <input
          type="checkbox"
          className="rounded text-blue-600 focus:ring-blue-500"
          checked={Boolean(id && selectedIds.includes(id))}
          onChange={() => id && onToggle(id)}
        />
      </div>
      <div className="flex-1 truncate p-3 font-medium text-gray-900" title={p.nama || '-'}>
        {p.nama || '-'}
      </div>
      <div className="hidden flex-1 truncate p-3 text-gray-500 sm:block" title={p.kelas || p.jabatan || p.__recipientInfo || '-'}>
        {p.kelas || p.jabatan || p.__recipientInfo || '-'}
      </div>
      <div className="hidden flex-1 truncate p-3 text-gray-400 md:block" title={p.email || '-'}>
        {p.email || '-'}
      </div>
    </div>
  )
}

/* ================== jsPDF Lazy Load ================== */
let jsPDFInstance = null
const loadJsPDF = async () => {
  if (jsPDFInstance) return jsPDFInstance
  const mod = await import('jspdf')
  jsPDFInstance = mod.default
  return jsPDFInstance
}

let pdfJsInstance = null
const loadPdfJs = async () => {
  if (pdfJsInstance) return pdfJsInstance
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url')
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  pdfJsInstance = pdfjs
  return pdfJsInstance
}

/* ================== FONT UTILS ================== */
const FONT_OPTIONS = [
  { value: 'Helvetica', label: 'Helvetica / Arial', css: 'Helvetica, Arial, sans-serif', pdf: 'helvetica' },
  { value: 'Arial', label: 'Arial', css: 'Arial, Helvetica, sans-serif', pdf: 'helvetica' },
  { value: 'Verdana', label: 'Verdana', css: 'Verdana, Geneva, sans-serif', pdf: 'helvetica' },
  { value: 'Tahoma', label: 'Tahoma', css: 'Tahoma, Geneva, sans-serif', pdf: 'helvetica' },
  { value: 'Trebuchet MS', label: 'Trebuchet MS', css: '"Trebuchet MS", Helvetica, sans-serif', pdf: 'helvetica' },
  { value: 'Segoe UI', label: 'Segoe UI', css: '"Segoe UI", system-ui, sans-serif', pdf: 'helvetica' },
  { value: 'Roboto', label: 'Roboto', css: 'Roboto, system-ui, -apple-system, "Segoe UI", sans-serif', pdf: 'helvetica' },
  { value: 'Poppins', label: 'Poppins', css: '"Poppins", system-ui, -apple-system, "Segoe UI", sans-serif', pdf: 'helvetica' },
  { value: 'Montserrat', label: 'Montserrat', css: 'Montserrat, system-ui, -apple-system, "Segoe UI", sans-serif', pdf: 'helvetica' },
  { value: 'Lato', label: 'Lato', css: 'Lato, system-ui, -apple-system, "Segoe UI", sans-serif', pdf: 'helvetica' },
  { value: 'Open Sans', label: 'Open Sans', css: '"Open Sans", system-ui, -apple-system, "Segoe UI", sans-serif', pdf: 'helvetica' },
  { value: 'Times', label: 'Times New Roman', css: '"Times New Roman", Times, serif', pdf: 'times' },
  { value: 'Georgia', label: 'Georgia', css: 'Georgia, "Times New Roman", serif', pdf: 'times' },
  { value: 'Garamond', label: 'Garamond', css: 'Garamond, "Times New Roman", serif', pdf: 'times' },
  { value: 'Palatino', label: 'Palatino', css: 'Palatino, "Palatino Linotype", Georgia, serif', pdf: 'times' },
  { value: 'Cambria', label: 'Cambria', css: 'Cambria, Georgia, serif', pdf: 'times' },
  { value: 'Merriweather', label: 'Merriweather', css: 'Merriweather, Georgia, "Times New Roman", serif', pdf: 'times' },
  { value: 'Playfair Display', label: 'Playfair Display', css: '"Playfair Display", Georgia, "Times New Roman", serif', pdf: 'times' },
  { value: 'Courier', label: 'Courier New', css: '"Courier New", Courier, monospace', pdf: 'courier' },
  { value: 'Consolas', label: 'Consolas', css: 'Consolas, "Courier New", monospace', pdf: 'courier' },
  { value: 'Lucida Console', label: 'Lucida Console', css: '"Lucida Console", Monaco, monospace', pdf: 'courier' },
  { value: 'Impact', label: 'Impact', css: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif', pdf: 'helvetica' },
  { value: 'Comic Sans MS', label: 'Comic Sans MS', css: '"Comic Sans MS", "Comic Sans", cursive', pdf: 'helvetica' },
  { value: 'Brush Script MT', label: 'Brush Script MT', css: '"Brush Script MT", "Segoe Script", cursive', pdf: 'times' },
  { value: 'Dancing Script', label: 'Dancing Script', css: '"Dancing Script", "Brush Script MT", cursive', pdf: 'times' },
  { value: 'Great Vibes', label: 'Great Vibes', css: '"Great Vibes", "Brush Script MT", cursive', pdf: 'times' }
]

const FONT_STYLE_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'bold', label: 'Bold' },
  { value: 'italic', label: 'Italic' },
  { value: 'bolditalic', label: 'Bold Italic' }
]

const TEXT_DECORATION_OPTIONS = [
  { value: 'none', label: 'Tanpa Garis' },
  { value: 'underline', label: 'Underline' },
  { value: 'overline', label: 'Overline' },
  { value: 'line-through', label: 'Coret Tengah' }
]

const getFontOption = (fontFamily) => {
  const normalized = (fontFamily || '').toLowerCase()
  return FONT_OPTIONS.find((opt) => opt.value.toLowerCase() === normalized) || null
}

const getPdfFont = (fontFamily) => {
  const option = getFontOption(fontFamily)
  if (option?.pdf) return option.pdf

  const f = (fontFamily || '').toLowerCase()
  if (f.includes('courier') || f.includes('consolas') || f.includes('mono')) return 'courier'
  if (f.includes('times') || f.includes('georgia') || f.includes('garamond') || f.includes('serif')) return 'times'
  return 'helvetica'
}

const getCssFontFamily = (fontFamily) => {
  const option = getFontOption(fontFamily)
  if (option?.css) return option.css

  const f = (fontFamily || '').toLowerCase()
  if (f.includes('courier')) return '"Courier New", Courier, monospace'
  if (f.includes('garamond')) return 'Garamond, "Times New Roman", serif'
  if (f.includes('georgia')) return 'Georgia, "Times New Roman", serif'
  if (f.includes('times')) return '"Times New Roman", Times, serif'
  if (f.includes('poppins')) return '"Poppins", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  if (f.includes('roboto')) return 'Roboto, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  return 'Helvetica, Arial, sans-serif'
}

/* ================== UTILS ================== */
const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v)
const isSameOriginUrl = (value = '') => {
  if (typeof window === 'undefined') return false
  try {
    return new URL(String(value || ''), window.location.origin).origin === window.location.origin
  } catch {
    return false
  }
}
const fetchCredentialsForUrl = (value = '') => {
  const raw = String(value || '')
  if (!isHttpUrl(raw)) return 'same-origin'
  return isSameOriginUrl(raw) ? 'same-origin' : 'omit'
}
const clamp = (n, min, max) => Math.min(Math.max(n, min), max)
const uniqueNonEmpty = (values = []) =>
  Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))

const getOutputFormat = (format) =>
  OUTPUT_FORMATS.find((item) => item.value === format) || OUTPUT_FORMATS[0]

const getPathLikeValue = (value) => {
  if (!value) return ''
  const isFileLike =
    (typeof File !== 'undefined' && value instanceof File) ||
    (typeof Blob !== 'undefined' && value instanceof Blob)
  if (isFileLike) return value.name || ''

  const raw = String(value || '').trim()
  if (!raw) return ''

  try {
    const base =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost'
    const url = new URL(raw, base)
    return url.searchParams.get('path') || url.pathname || raw
  } catch {
    const pathMatch = raw.match(/[?&]path=([^&]+)/i)
    return pathMatch?.[1] ? decodeURIComponent(pathMatch[1]) : raw
  }
}

const getFileExtension = (value) => {
  const path = getPathLikeValue(value)
  const clean = String(path || '').split('?')[0].split('#')[0]
  const ext = clean.split('.').pop()?.toLowerCase() || ''
  return clean.includes('.') ? ext : ''
}

const getTemplateBackgroundType = (value) => {
  const mime = String(value?.type || '').toLowerCase()
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'image'

  const ext = getFileExtension(value)
  if (ext === 'pdf') return 'pdf'
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image'
  return 'unknown'
}

const validateTemplateFile = (file) => {
  if (!file) return 'File tidak ditemukan'
  const ext = getFileExtension(file)
  if (!TEMPLATE_ALLOWED_EXTENSIONS.includes(ext)) {
    return 'Format template harus PDF, PNG, JPG, JPEG, atau WEBP'
  }

  const mime = String(file.type || '').toLowerCase()
  const allowedMimes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
  if (mime && !allowedMimes.includes(mime)) {
    return 'Tipe file template tidak sesuai. Gunakan PDF, PNG, JPG, JPEG, atau WEBP'
  }

  return ''
}

const safeSlug = (s) =>
  (s || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'event'

const nowIsoCompact = () => {
  const d = new Date()
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

const buildCertificateNumber = ({ eventDate, batchStamp, index }) => {
  const datePart = String(eventDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '')
  const batchPart = String(batchStamp || nowIsoCompact()).replace(/[^0-9]/g, '').slice(-6)
  const serial = String(Number(index || 0) + 1).padStart(4, '0')
  return `SERT-${datePart}-${batchPart}-${serial}`
}

const hexToRgb = (hex) => {
  if (!hex) return [0, 0, 0]
  let c = hex.replace('#', '')
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]
  const r = parseInt(c.substring(0, 2), 16)
  const g = parseInt(c.substring(2, 4), 16)
  const b = parseInt(c.substring(4, 6), 16)
  return [r, g, b]
}

const applyTextTransform = (text, transform) => {
  if (!text) return ''
  if (transform === 'uppercase') return text.toUpperCase()
  if (transform === 'lowercase') return text.toLowerCase()
  if (transform === 'capitalize') return text.replace(/\b\w/g, (l) => l.toUpperCase())
  return text
}

const fetchImageAsDataUrl = async (url) => {
  try {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), {
      credentials: fetchCredentialsForUrl(url)
    })
    if (!res.ok) throw new Error('Gagal fetch background')
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.readAsDataURL(blob)
    })
  } catch (error) {
    console.error('Error image:', error)
    return null
  }
}

const readBlobAsDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Gagal membaca file'))
    reader.readAsDataURL(blob)
  })

const sourceToArrayBuffer = async (source) => {
  if (typeof Blob !== 'undefined' && source instanceof Blob) return source.arrayBuffer()

  const raw = String(source || '')
  const fetchOptions = raw ? { credentials: fetchCredentialsForUrl(raw) } : undefined
  const res = await fetch(raw, fetchOptions)
  if (!res.ok) throw new Error('Gagal membaca PDF template')
  return res.arrayBuffer()
}

const renderPdfFirstPageToDataUrl = async (source) => {
  if (typeof document === 'undefined') throw new Error('Browser tidak mendukung preview PDF')

  const pdfjs = await loadPdfJs()
  const arrayBuffer = await sourceToArrayBuffer(source)
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) })
  const pdf = await loadingTask.promise

  try {
    const page = await pdf.getPage(1)
    const baseViewport = page.getViewport({ scale: 1 })
    const renderScale = Math.max(
      (A4_WIDTH * IMAGE_OUTPUT_SCALE) / baseViewport.width,
      (A4_HEIGHT * IMAGE_OUTPUT_SCALE) / baseViewport.height
    )
    const viewport = page.getViewport({ scale: renderScale })

    const pageCanvas = document.createElement('canvas')
    const pageCtx = pageCanvas.getContext('2d')
    if (!pageCtx) throw new Error('Canvas browser tidak tersedia')

    pageCanvas.width = Math.round(viewport.width)
    pageCanvas.height = Math.round(viewport.height)

    await page.render({ canvasContext: pageCtx, viewport }).promise
    page.cleanup?.()

    const outCanvas = document.createElement('canvas')
    const outCtx = outCanvas.getContext('2d')
    if (!outCtx) throw new Error('Canvas browser tidak tersedia')

    outCanvas.width = A4_WIDTH * IMAGE_OUTPUT_SCALE
    outCanvas.height = A4_HEIGHT * IMAGE_OUTPUT_SCALE
    outCtx.fillStyle = '#ffffff'
    outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height)
    outCtx.drawImage(pageCanvas, 0, 0, outCanvas.width, outCanvas.height)

    return outCanvas.toDataURL('image/png')
  } finally {
    await pdf.destroy?.()
  }
}

const resolveTemplateBackgroundDataUrl = async (templateOrFile) => {
  if (!templateOrFile) return null

  const isFileLike =
    (typeof File !== 'undefined' && templateOrFile instanceof File) ||
    (typeof Blob !== 'undefined' && templateOrFile instanceof Blob)
  if (isFileLike) {
    const type = getTemplateBackgroundType(templateOrFile)
    if (type === 'pdf') return renderPdfFirstPageToDataUrl(templateOrFile)
    return readBlobAsDataUrl(templateOrFile)
  }

  const type = templateOrFile.__bgType || getTemplateBackgroundType(templateOrFile.background_url || templateOrFile.__bgUrl)
  const bgUrl = templateOrFile.__bgUrl || templateOrFile.background_url || ''
  if (!bgUrl) return null

  if (type === 'pdf') return renderPdfFirstPageToDataUrl(bgUrl)
  return fetchImageAsDataUrl(bgUrl)
}

const loadImageElement = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Gagal memuat gambar preview'))
    image.src = src
  })

const canvasToBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Gagal membuat file gambar'))
    }, type, quality)
  })

const createSignedUrl = async (bucket, pathOrUrl) => {
  const rawValue = String(pathOrUrl || '').trim()
  if (!rawValue) return ''

  const extractedPath = extractObjectPath(bucket, rawValue)
  if (isHttpUrl(rawValue) && !extractedPath) return rawValue

  const candidates = uniqueNonEmpty([
    extractedPath,
    isHttpUrl(rawValue) ? '' : rawValue
  ])

  let lastError = null
  for (const candidate of candidates) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(candidate, SIGNED_EXPIRES)
    if (error) {
      lastError = error
      continue
    }
    if (data?.signedUrl) return data.signedUrl
  }

  if (lastError) throw lastError
  return ''
}

const canAccessSignedUrl = async (signedUrl) => {
  if (!signedUrl) return false
  try {
    const response = await fetch(signedUrl, {
      method: 'HEAD',
      credentials: fetchCredentialsForUrl(signedUrl)
    })
    return response.ok
  } catch {
    return false
  }
}

const createSignedUrlWithFallbackBuckets = async (buckets, pathOrUrl) => {
  const rawValue = String(pathOrUrl || '').trim()
  if (!rawValue) return ''
  if (isHttpUrl(rawValue) && !buckets.some((bucket) => extractObjectPath(bucket, rawValue))) {
    return rawValue
  }

  let lastError = null
  for (const bucket of buckets) {
    try {
      const signed = await createSignedUrl(bucket, rawValue)
      if (!signed) continue
      // eslint-disable-next-line no-await-in-loop
      if (await canAccessSignedUrl(signed)) return signed
    } catch (error) {
      lastError = error
    }
  }

  if (lastError) throw lastError
  return ''
}

// fallback data url type check
const guessImgExtForJsPDF = (dataUrl, rawName = '') => {
  const s = (dataUrl || '').slice(0, 40).toLowerCase()
  const r = (rawName || '').toLowerCase()
  if (s.includes('data:image/png') || r.endsWith('.png')) return 'PNG'
  return 'JPEG'
}

const getCertificateFieldText = (key, data) => {
  if (key === 'nama') return data.nama || ''
  if (key === 'event') return data.event || ''
  if (key === 'tanggal') return data.dateDisplay || ''
  if (key === 'nomor') return data.nomor || data.certificate_number || ''
  return ''
}

const shouldRenderCertificateField = (key, field, data = {}) => (
  Boolean(field?.active) || (key === 'nomor' && Boolean(data?.nomor || data?.certificate_number))
)

const drawCertificateTextOnCanvas = ({ ctx, data, template, width, height, scale }) => {
  const fields = template.fields || defaultFields

  Object.keys(fields).forEach((key) => {
    const field = fields[key]
    if (!shouldRenderCertificateField(key, field, data)) return

    let text = getCertificateFieldText(key, data)
    if (!text) return

    const fontSize = (field.fontSize || 12) * scale
    const fontWeight = field.fontStyle?.includes('bold') ? '700' : '400'
    const fontStyle = field.fontStyle?.includes('italic') ? 'italic' : 'normal'
    const fontFamily = getCssFontFamily(field.fontFamily)
    const posX = clamp(field.x ?? width / 2, 0, width) * scale
    const posY = clamp(field.y ?? height / 2, 0, height) * scale

    text = applyTextTransform(text, field.textTransform)

    ctx.save()
    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
    ctx.fillStyle = field.color || '#000000'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(text, posX, posY)

    const decoration = field.textDecoration || 'none'
    if (decoration !== 'none') {
      const metrics = ctx.measureText(text)
      const halfWidth = metrics.width / 2
      const yOffset =
        decoration === 'underline'
          ? fontSize * 0.16
          : decoration === 'overline'
            ? -fontSize * 0.82
            : -fontSize * 0.32

      ctx.beginPath()
      ctx.lineWidth = Math.max(1, fontSize * 0.045)
      ctx.strokeStyle = field.color || '#000000'
      ctx.moveTo(posX - halfWidth, posY + yOffset)
      ctx.lineTo(posX + halfWidth, posY + yOffset)
      ctx.stroke()
    }

    ctx.restore()
  })
}

/* ================== DEFAULT CONFIG ================== */
// x, y = baseline center
const defaultFields = {
  nama: {
    label: 'Nama Peserta',
    x: A4_WIDTH / 2,
    y: 260,
    active: true,
    fontSize: 40,
    fontStyle: 'bold',
    color: '#000000',
    fontFamily: 'Helvetica',
    textTransform: 'uppercase',
    textDecoration: 'none',
    simulationText: 'BUDI SANTOSO, S.KOM'
  },
  event: {
    label: 'Nama Event',
    x: A4_WIDTH / 2,
    y: 320,
    active: true,
    fontSize: 24,
    fontStyle: 'normal',
    color: '#333333',
    fontFamily: 'Helvetica',
    textTransform: 'none',
    textDecoration: 'none',
    simulationText: 'Workshop Fullstack Development'
  },
  tanggal: {
    label: 'Tanggal',
    x: A4_WIDTH / 2,
    y: 360,
    active: true,
    fontSize: 16,
    fontStyle: 'italic',
    color: '#555555',
    fontFamily: 'Helvetica',
    textTransform: 'none',
    textDecoration: 'none',
    simulationText: '29 November 2025'
  },
  nomor: {
    label: 'No. Sertifikat',
    x: A4_WIDTH / 2,
    y: 450,
    active: true,
    fontSize: 12,
    fontStyle: 'normal',
    color: '#000000',
    fontFamily: 'Courier',
    textTransform: 'none',
    textDecoration: 'none',
    simulationText: 'SERT-20260528-093000-0001'
  }
}

const cloneTemplateFields = (fields = defaultFields) =>
  Object.keys(fields || {}).reduce((acc, key) => {
    acc[key] = { ...(fields[key] || {}) }
    return acc
  }, {})

const buildFieldsFromLegacyTemplate = (t) => {
  // gunakan legacy posisi + font dasar, tetap konsisten dengan defaultFields
  const baseColor = t?.text_color || '#000000'
  const baseFamily = t?.font_family || 'Helvetica'
  const baseSize = Number.isFinite(t?.font_size) ? t.font_size : 24

  const merged = cloneTemplateFields(defaultFields)
  merged.nama = {
    ...merged.nama,
    x: Number.isFinite(t?.nama_x) ? t.nama_x : merged.nama.x,
    y: Number.isFinite(t?.nama_y) ? t.nama_y : merged.nama.y,
    color: baseColor,
    fontFamily: baseFamily,
    fontSize: Math.max(baseSize + 16, 20)
  }
  merged.event = {
    ...merged.event,
    x: Number.isFinite(t?.event_x) ? t.event_x : merged.event.x,
    y: Number.isFinite(t?.event_y) ? t.event_y : merged.event.y,
    color: baseColor,
    fontFamily: baseFamily,
    fontSize: Math.max(baseSize, 14)
  }
  merged.tanggal = {
    ...merged.tanggal,
    x: Number.isFinite(t?.tanggal_x) ? t.tanggal_x : merged.tanggal.x,
    y: Number.isFinite(t?.tanggal_y) ? t.tanggal_y : merged.tanggal.y,
    color: baseColor,
    fontFamily: baseFamily,
    fontSize: Math.max(baseSize - 8, 10)
  }
  return merged
}

const parseTemplateFields = (value) => {
  if (!value) return null
  if (typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') return null

  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    return null
  }

  return null
}

const normalizeTemplate = (t) => {
  const merged = cloneTemplateFields(defaultFields)
  const parsedFields = parseTemplateFields(t?.fields)

  const hasFields =
    parsedFields &&
    Object.keys(parsedFields).length > 0

  const sourceFields = hasFields ? parsedFields : buildFieldsFromLegacyTemplate(t)

  Object.keys(sourceFields || {}).forEach((k) => {
    merged[k] = { ...merged[k], ...(sourceFields[k] || {}) }
  })

  return {
    ...t,
    fields: merged
  }
}

const createDefaultForm = () => ({
  nama: '',
  deskripsi: '',
  backgroundPath: '', // kita simpan ke background_url (isi path, bukan public url)
  backgroundFile: null,
  backgroundType: 'image',
  previewUrl: '',
  fields: cloneTemplateFields(defaultFields)
})

const CertificateLayoutPreview = ({
  backgroundUrl,
  fields,
  className = '',
  emptyLabel = 'Background tidak bisa dimuat',
  showEmptyIcon = false
}) => {
  const activeFields = fields || defaultFields

  return (
    <div className={`relative aspect-[842/595] overflow-hidden bg-white ${className}`}>
      {backgroundUrl ? (
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${A4_WIDTH} ${A4_HEIGHT}`} preserveAspectRatio="none">
          <image href={backgroundUrl} x="0" y="0" width={A4_WIDTH} height={A4_HEIGHT} preserveAspectRatio="none" />

          {Object.keys(activeFields).map((key) => {
            const f = activeFields[key]
            if (!f?.active) return null
            const content = applyTextTransform(f.simulationText || 'Sample Text', f.textTransform)

            return (
              <text
                key={key}
                x={f.x}
                y={f.y}
                textAnchor="middle"
                style={{
                  fontSize: f.fontSize,
                  fontFamily: getCssFontFamily(f.fontFamily),
                  fontWeight: f.fontStyle?.includes('bold') ? 'bold' : 'normal',
                  fontStyle: f.fontStyle?.includes('italic') ? 'italic' : 'normal',
                  textDecoration: f.textDecoration || 'none',
                  fill: f.color,
                  pointerEvents: 'none'
                }}
              >
                {content}
              </text>
            )
          })}
        </svg>
      ) : (
        <div className="flex h-full flex-col items-center justify-center text-center text-gray-400">
          {showEmptyIcon && <span className="text-4xl mb-2">ðŸ–¼ï¸</span>}
          <span className="px-3 text-sm font-medium">{emptyLabel}</span>
        </div>
      )}
    </div>
  )
}

/* ================== MAIN COMPONENT ================== */
const AdminSertifikat = () => {
  const { profile } = useAuthStore()
  const [mode, setMode] = useState('generator')
  const [templateVersion, setTemplateVersion] = useState(0)

  const bumpTemplateVersion = () => setTemplateVersion((v) => v + 1)

  // UX guard saja. RLS harus tetap jadi tameng utama.
  if (profile && profile.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 flex items-center justify-center p-6">
        <div className="bg-white border rounded-2xl p-6 shadow-sm max-w-md w-full text-center">
          <div className="text-4xl mb-3">⛔</div>
          <h1 className="font-bold text-lg text-gray-900">Akses Ditolak</h1>
          <p className="text-gray-600 mt-2 text-sm">
            Halaman ini hanya untuk admin. Pastikan RLS juga membatasi akses admin saja.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 text-gray-800 font-sans py-6">
      <div className="w-full space-y-8 px-4 sm:px-6 lg:px-8">
        {/* Navbar */}
        <div className="page-title-card">
          <div className="page-title-layout">
            <div className="page-title-main">
              <div className="page-title-icon bg-blue-100 text-blue-700">🎓</div>
              <div>
                <h1 className="page-title-heading">Certificate Pro</h1>
                <p className="page-title-description">Admin Dashboard Sertifikat</p>
              </div>
            </div>

            <div className="page-title-actions rounded-xl border border-gray-200 bg-gray-100 p-1">
              {[
                { id: 'generator', label: 'Generator Massal' },
                { id: 'template', label: 'Desainer Template' },
                { id: 'history', label: 'Riwayat' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setMode(tab.id)}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    mode === tab.id ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="w-full">
          {mode === 'generator' && <GeneratorSection templateVersion={templateVersion} />}
          {mode === 'template' && <TemplateManagerSection onTemplateChanged={bumpTemplateVersion} />}
          {mode === 'history' && <HistorySection />}
        </div>
      </div>
    </div>
  )
}

/* ================== 1. GENERATOR SECTION ================== */
const GeneratorSection = ({ templateVersion }) => {
  const { pushToast, setLoading } = useUIStore()
  const toast = (type, message) => pushToast?.(type, message)

  // Data
  const [templateList, setTemplateList] = useState([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [kelasList, setKelasList] = useState([])
  const [ekskulList, setEskulList] = useState([])

  // Input
  const [eventName, setEventName] = useState('')
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10))
  const [outputFormat, setOutputFormat] = useState('pdf')
  const [previewFile, setPreviewFile] = useState(null)
  const [selectedTemplatePreviewUrl, setSelectedTemplatePreviewUrl] = useState('')

  // Peserta
  const [role, setRole] = useState('siswa')
  const [kelasFilter, setKelasFilter] = useState('')
  const [ekskulFilter, setEskulFilter] = useState('')
  const [peserta, setPeserta] = useState([])
  const [selectedIds, setSelectedIds] = useState([])

  // Status
  const [isProcessing, setIsProcessing] = useState(false)
  const [progressStatus, setProgressStatus] = useState('')

  useEffect(() => {
    let alive = true
    const init = async () => {
      try {
        const period = await loadCurrentAcademicPeriod()
        let ekskulQuery = supabase.from('ekskul').select('id, nama, tahun_ajaran, semester').order('nama')
        ekskulQuery = applyAcademicSemesterFilter(ekskulQuery, period)

        const [tplRes, klsRes, eksRes] = await Promise.all([
          supabase
            .from('templat_sertifikat_publik')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false }),
          supabase.from('kelas').select('*').order('nama'),
          ekskulQuery
        ])

        if (!alive) return

        const rawTpls = (tplRes.data || []).map(normalizeTemplate)

        const resolved = await Promise.all(
          rawTpls.map(async (t) => {
            const rawBg = t.background_url || ''
            let bgUrl = ''
            try {
              bgUrl = await createSignedUrlWithFallbackBuckets(CERT_TEMPLATE_BUCKET_FALLBACKS, rawBg)
            } catch {
              bgUrl = isHttpUrl(rawBg) ? rawBg : ''
            }
            const bgType = getTemplateBackgroundType(rawBg)
            let previewUrl = bgUrl
            if (bgType === 'pdf' && bgUrl) {
              try {
                previewUrl = await renderPdfFirstPageToDataUrl(bgUrl)
              } catch {
                previewUrl = ''
              }
            }
            return { ...t, __bgUrl: bgUrl, __bgType: bgType, __previewUrl: previewUrl }
          })
        )

        setTemplateList(resolved)
        if (resolved.length > 0) setSelectedTemplateId(resolved[0].id)

        setKelasList(klsRes.data || [])
        if (eksRes.error && /tahun_ajaran|semester/i.test(eksRes.error.message || '')) {
          const { data: legacyEskul, error: legacyEkskulError } = await supabase
            .from('ekskul')
            .select('id, nama')
            .order('nama')
          if (legacyEkskulError) throw legacyEkskulError
          setEskulList(legacyEskul || [])
        } else {
          if (eksRes.error) throw eksRes.error
          setEskulList(eksRes.data || [])
        }
      } catch (err) {
        toast('error', err.message || 'Gagal memuat data')
      }
    }

    init()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateVersion])

  const selectedTemplate = useMemo(
    () => templateList.find((t) => t.id === selectedTemplateId),
    [templateList, selectedTemplateId]
  )

  useEffect(() => {
    let alive = true

    const loadPreview = async () => {
      setSelectedTemplatePreviewUrl('')
      if (!selectedTemplate) return

      try {
        const rendered = selectedTemplate.__previewUrl || await resolveTemplateBackgroundDataUrl(selectedTemplate)
        if (alive) setSelectedTemplatePreviewUrl(rendered || selectedTemplate.__bgUrl || '')
      } catch {
        if (alive) setSelectedTemplatePreviewUrl(selectedTemplate.__bgType === 'image' ? selectedTemplate.__bgUrl || '' : '')
      }
    }

    loadPreview()

    return () => {
      alive = false
    }
  }, [selectedTemplate])

  useEffect(() => () => {
    if (previewFile?.url) URL.revokeObjectURL(previewFile.url)
  }, [previewFile?.url])

  const closePreview = () => {
    if (previewFile?.url) URL.revokeObjectURL(previewFile.url)
    setPreviewFile(null)
  }

  const loadPeserta = async () => {
    setLoading?.(true)
    setPeserta([])
    try {
      let rows = []

      if (role === 'ekskul') {
        if (!ekskulFilter) throw new Error('Pilih eskul terlebih dahulu')

        const period = await loadCurrentAcademicPeriod()
        let memberQuery = supabase
          .from('ekskul_anggota')
          .select('user_id')
          .eq('ekskul_id', ekskulFilter)
        memberQuery = applyAcademicSemesterFilter(memberQuery, period)

        let { data: memberRows, error: memberErr } = await memberQuery
        if (memberErr && /tahun_ajaran|semester/i.test(memberErr.message || '')) {
          ; ({ data: memberRows, error: memberErr } = await supabase
            .from('ekskul_anggota')
            .select('user_id')
            .eq('ekskul_id', ekskulFilter))
        }

        if (memberErr) throw memberErr

        const userIds = uniqueNonEmpty((memberRows || []).map((m) => m.user_id))
        if (userIds.length === 0) {
          setPeserta([])
          setSelectedIds([])
          toast('success', '0 data dimuat')
          return
        }

        const { data: profileRows, error: profileErr } = await supabase
          .from('profiles')
          .select('*')
          .in('id', userIds)
          .eq('role', 'siswa')
          .eq('status', 'active')
          .order('nama', { ascending: true })

        if (profileErr) throw profileErr

        const selectedEskul = ekskulList.find((e) => e.id === ekskulFilter)
        rows = (profileRows || []).map((p) => ({
          ...p,
          __recipientInfo: selectedEskul?.nama ? `Eskul: ${selectedEskul.nama}` : 'Eskul'
        }))
      } else {
        let q = supabase.from('profiles').select('*').eq('role', role).eq('status', 'active')
        if (role === 'siswa' && kelasFilter) q = q.eq('kelas', kelasFilter)

        const { data, error } = await q.order('nama', { ascending: true })
        if (error) throw error
        rows = data || []
      }

      setPeserta(rows)
      setSelectedIds(rows.map((p) => p.id))
      toast('success', `${rows.length} data dimuat`)
    } catch (err) {
      toast('error', err.message)
    } finally {
      setLoading?.(false)
    }
  }

  const generatePdf = async ({ doc, data, template, bgDataUrl, width, height }) => {
    if (bgDataUrl) {
      const ext = guessImgExtForJsPDF(bgDataUrl, template?.background_url)
      doc.addImage(bgDataUrl, ext, 0, 0, width, height)
    }

    const fields = template.fields || defaultFields

    Object.keys(fields).forEach((key) => {
      const field = fields[key]
      if (!shouldRenderCertificateField(key, field, data)) return

      let text = getCertificateFieldText(key, data)
      if (!text) return

      const fontSize = field.fontSize || 12
      const [r, g, b] = hexToRgb(field.color || '#000000')

      doc.setFont(getPdfFont(field.fontFamily), field.fontStyle || 'normal')
      doc.setFontSize(fontSize)
      doc.setTextColor(r, g, b)

      text = applyTextTransform(text, field.textTransform)

      const posX = clamp(field.x ?? width / 2, 0, width)
      const posY = clamp(field.y ?? height / 2, 0, height)

      doc.text(text, posX, posY, { align: 'center' })

      const decoration = field.textDecoration || 'none'
      if (decoration !== 'none') {
        const textWidth = doc.getTextWidth(text)
        const yOffset =
          decoration === 'underline'
            ? fontSize * 0.16
            : decoration === 'overline'
              ? -fontSize * 0.82
              : -fontSize * 0.32

        doc.setLineWidth(Math.max(0.5, fontSize * 0.045))
        doc.line(posX - textWidth / 2, posY + yOffset, posX + textWidth / 2, posY + yOffset)
      }
    })
  }

  const generateImageBlob = async ({ data, template, bgDataUrl, format }) => {
    const meta = getOutputFormat(format)
    const canvas = document.createElement('canvas')
    const scale = IMAGE_OUTPUT_SCALE
    canvas.width = A4_WIDTH * scale
    canvas.height = A4_HEIGHT * scale

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas browser tidak tersedia')

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    if (bgDataUrl) {
      const image = await loadImageElement(bgDataUrl)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    }

    drawCertificateTextOnCanvas({
      ctx,
      data,
      template,
      width: A4_WIDTH,
      height: A4_HEIGHT,
      scale
    })

    return canvasToBlob(canvas, meta.contentType, format === 'jpg' ? 0.92 : undefined)
  }

  const generateCertificateBlob = async ({ data, template, bgDataUrl, format }) => {
    const meta = getOutputFormat(format)

    if (meta.value !== 'pdf') {
      return generateImageBlob({ data, template, bgDataUrl, format: meta.value })
    }

    const jsPDF = await loadJsPDF()
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
    const w = doc.internal.pageSize.getWidth()
    const h = doc.internal.pageSize.getHeight()

    await generatePdf({ doc, data, template, bgDataUrl, width: w, height: h })

    return doc.output('blob')
  }

  const handleProcess = async (isPreview = false) => {
    if (!selectedTemplate || !eventName?.trim()) {
      toast('warning', 'Nama event & template wajib diisi')
      return
    }

    setIsProcessing(true)
    setProgressStatus('')

    try {
      const selectedOutput = getOutputFormat(outputFormat)
      let bgDataUrl = null
      try {
        bgDataUrl = await resolveTemplateBackgroundDataUrl(selectedTemplate)
      } catch (bgErr) {
        console.warn('resolveTemplateBackgroundDataUrl gagal, mencoba fallback __previewUrl:', bgErr)
      }

      // Fallback: use the pre-rendered preview that was loaded when template list initialized
      if (!bgDataUrl && selectedTemplate.__previewUrl) {
        bgDataUrl = selectedTemplate.__previewUrl
      }

      if ((selectedTemplate.background_url || selectedTemplate.__bgUrl) && !bgDataUrl) {
        throw new Error('Template sertifikat gagal dibaca. Cek file background template lalu coba generate ulang.')
      }

      const dateDisplay = new Date(eventDate).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })

      const batchStamp = nowIsoCompact()
      const targets = isPreview
        ? [
            {
              id: 'preview',
              nama: selectedTemplate.fields?.nama?.simulationText || 'Contoh Nama Peserta',
              event: eventName.trim(),
              dateDisplay,
              nomor: selectedTemplate.fields?.nomor?.simulationText || buildCertificateNumber({ eventDate, batchStamp, index: 0 })
            }
          ]
        : peserta
            .filter((p) => selectedIds.includes(p.id))
            .map((p, index) => ({
              ...p,
              event: eventName.trim(),
              dateDisplay,
              nomor: buildCertificateNumber({ eventDate, batchStamp, index })
            }))

      if (targets.length === 0) throw new Error('Pilih minimal satu peserta')

      let success = 0
      const eventFolder = safeSlug(eventName)
      const baseFolder = `certs/${eventFolder}/${eventDate}`

      for (let i = 0; i < targets.length; i++) {
        const p = targets[i]
        if (!isPreview) setProgressStatus(`Memproses ${i + 1}/${targets.length}: ${p.nama}`)

        const blob = await generateCertificateBlob({
          data: p,
          template: selectedTemplate,
          bgDataUrl,
          format: selectedOutput.value
        })

        if (isPreview) {
          if (previewFile?.url) URL.revokeObjectURL(previewFile.url)
          const previewUrl = URL.createObjectURL(blob)
          setPreviewFile({
            url: previewUrl,
            format: selectedOutput.value,
            filename: `PREVIEW-${safeSlug(eventName)}.${selectedOutput.extension}`
          })
          break
        }

        const fileName = `${batchStamp}_${p.id}.${selectedOutput.extension}`
        const uploadFile = new File([blob], fileName, { type: selectedOutput.contentType })
        const filePath = `${baseFolder}/${fileName}`

        const { error: upErr } = await supabase.storage.from(CERT_BUCKET).upload(filePath, uploadFile, {
          cacheControl: '3600',
          contentType: selectedOutput.contentType,
          upsert: false
        })
        if (upErr) throw upErr

        // IMPORTANT: schema kamu cuma punya file_url (NOT NULL)
        // Kita simpan "path" ke file_url, lalu download pakai signed URL.
        const insertPayload = {
          user_id: p.id,
          nama_penerima: p.nama,
          email: p.email || null,
          kelas: p.kelas || null,
          event: eventName.trim(),
          event_date: eventDate,
          certificate_number: p.nomor,
          file_url: filePath,
          sent: true,
          sent_at: new Date().toISOString()
        }
        let { data: insData, error: insErr } = await supabase.from('certificates').insert(insertPayload).select('id')
        if (insErr && /certificate_number/i.test(insErr.message || '')) {
          const { certificate_number, ...legacyPayload } = insertPayload
          ; ({ data: insData, error: insErr } = await supabase.from('certificates').insert(legacyPayload).select('id'))
        }
        if (insErr) throw insErr

        if (insData && insData[0]?.id) {
          const certId = insData[0].id
          apiFetch(`/api/admin/certificates/${certId}/send-email`, { method: 'POST' })
            .catch((err) => {
              console.error(`Gagal mengirim email untuk sertifikat ID ${certId}:`, err)
            })
        }

        success++
      }

      if (!isPreview) {
        toast('success', `${success} sertifikat berhasil dibuat`)
        await loadPeserta()
      } else {
        toast('success', `Preview ${selectedOutput.label} siap ditampilkan`)
      }
    } catch (err) {
      console.error(err)
      toast('error', err.message || 'Gagal memproses sertifikat')
    } finally {
      setIsProcessing(false)
      setProgressStatus('')
    }
  }

  return (
    <>
    <div className="grid lg:grid-cols-3 gap-8">
      {/* Kiri */}
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2 border-b pb-4">
            <span>⚙️</span> Konfigurasi Event
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nama Event / Acara</label>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Contoh: Juara 1 Lomba Coding"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tanggal Sertifikat</label>
              <input
                type="date"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pilih Template</label>
              <select
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
              >
                {templateList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nama}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Format File untuk Peserta</label>
              <div className="grid grid-cols-3 gap-2">
                {OUTPUT_FORMATS.map((format) => (
                  <button
                    key={format.value}
                    type="button"
                    onClick={() => setOutputFormat(format.value)}
                    className={`py-2 rounded-lg border text-sm font-semibold transition-colors ${
                      outputFormat === format.value
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {format.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => handleProcess(true)}
              disabled={isProcessing || !eventName?.trim() || !selectedTemplate}
              className="w-full py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors mt-2 flex items-center justify-center gap-2"
            >
              Preview {getOutputFormat(outputFormat).label}
            </button>

            <p className="text-xs text-gray-500 leading-relaxed">
              Template bisa PDF, PNG, atau JPG. File hasil bisa dipilih PDF, PNG, atau JPG sebelum dibuat untuk peserta.
              Download pakai signed URL.
            </p>
          </div>
        </div>

        {selectedTemplate && (
          <div className="bg-white p-4 rounded-xl border shadow-sm">
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide text-center">
              Preview Template Hasil Edit
            </p>
            <CertificateLayoutPreview
              backgroundUrl={selectedTemplatePreviewUrl}
              fields={selectedTemplate.fields}
              className="rounded border bg-gray-100"
              emptyLabel="Background tidak bisa dimuat (cek path/izin storage)."
            />
          </div>
        )}
      </div>

      {/* Kanan */}
      <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col h-[80vh]">
        <div className="flex justify-between items-center mb-6 border-b pb-4">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <span>👥</span> Daftar Penerima
          </h3>

          <div className="flex flex-wrap gap-2">
            <select
              className="min-h-[2.625rem] rounded-lg border bg-gray-50 px-3 py-2 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="siswa">Siswa</option>
              <option value="guru">Guru</option>
              <option value="ekskul">Anggota Eskul</option>
            </select>

            {role === 'siswa' && (
              <select
                className="min-h-[2.625rem] rounded-lg border bg-gray-50 px-3 py-2 text-sm"
                value={kelasFilter}
                onChange={(e) => setKelasFilter(e.target.value)}
              >
                <option value="">Semua Kelas</option>
                {kelasList.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.nama}
                  </option>
                ))}
              </select>
            )}

            {role === 'ekskul' && (
              <select
                className="min-h-[2.625rem] rounded-lg border bg-gray-50 px-3 py-2 text-sm"
                value={ekskulFilter}
                onChange={(e) => setEskulFilter(e.target.value)}
              >
                <option value="">Pilih Eskul</option>
                {ekskulList.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nama}
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={loadPeserta}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 shadow-sm"
            >
              Muat Data
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto rounded-lg border border-gray-200 mb-4 flex flex-col min-h-[400px]">
          <div className="bg-gray-50 flex border-b sticky top-0 z-10">
            <div className="p-3 w-12 flex-shrink-0 text-center border-r">
              <input
                type="checkbox"
                className="rounded text-blue-600 focus:ring-blue-500"
                onChange={() =>
                  setSelectedIds(selectedIds.length === peserta.length ? [] : peserta.map((p) => p.id))
                }
                checked={peserta.length > 0 && selectedIds.length === peserta.length}
              />
            </div>
            <div className="p-3 flex-1 font-semibold text-gray-700">Nama Lengkap</div>
            <div className="p-3 flex-1 font-semibold text-gray-700 hidden sm:block">Info / Kelas</div>
            <div className="p-3 flex-1 font-semibold text-gray-700 hidden md:block">Email</div>
          </div>
          
          <div className="flex-1 relative">
            {peserta.length === 0 ? (
              <div className="p-12 text-center text-gray-400 italic">
                Klik tombol "Muat Data" untuk menampilkan daftar peserta
              </div>
            ) : (
              <div className="absolute inset-0">
                <List
                  rowComponent={CertificateParticipantRow}
                  rowCount={peserta.length}
                  rowHeight={50}
                  rowProps={{
                    items: peserta,
                    selectedIds,
                    onToggle: (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
                  }}
                  style={{ height: 400, width: '100%' }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {progressStatus && (
            <div className="w-full bg-blue-50 text-blue-700 px-4 py-2 rounded-lg text-sm font-medium text-center animate-pulse border border-blue-100">
              {progressStatus}
            </div>
          )}

          <button
            onClick={() => handleProcess(false)}
            disabled={isProcessing || selectedIds.length === 0}
            className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg font-bold shadow-md hover:shadow-lg disabled:opacity-50 disabled:shadow-none transition-all flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Sedang Memproses...
              </span>
            ) : (
              <>🚀 Buat {getOutputFormat(outputFormat).label} untuk {selectedIds.length} Peserta Terpilih</>
            )}
          </button>
        </div>
      </div>
    </div>
    {previewFile && (
      <CertificatePreviewModal
        preview={previewFile}
        onClose={closePreview}
      />
    )}
    </>
  )
}

const CertificatePreviewModal = ({ preview, onClose }) => {
  if (!preview?.url) return null

  const isPdf = preview.format === 'pdf'
  const isImage = ['png', 'jpg'].includes(preview.format)

  return (
    <div
      className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={() => onClose?.()}
    >
      <div
        className="w-full max-w-6xl h-[92vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between bg-white">
          <div>
            <h3 className="font-bold text-gray-900">Preview Sertifikat</h3>
            <p className="text-xs text-gray-500 mt-0.5">{preview.filename}</p>
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            className="w-9 h-9 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold"
            aria-label="Tutup preview"
          >
            x
          </button>
        </div>

        <div className="flex-1 bg-slate-900 overflow-hidden flex items-center justify-center">
          {isPdf && (
            <iframe
              src={preview.url}
              title="Preview Sertifikat PDF"
              className="w-full h-full border-0 bg-white"
            />
          )}
          {isImage && (
            <img
              src={preview.url}
              alt="Preview Sertifikat"
              className="max-w-full max-h-full object-contain"
            />
          )}
        </div>

        <div className="p-4 border-t bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-gray-600">
            Preview ini memakai format yang sama dengan file yang akan dibuat untuk peserta.
          </p>
          <div className="flex gap-2 justify-end">
            <a
              href={preview.url}
              download={preview.filename}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50"
            >
              Download Preview
            </a>
            <button
              type="button"
              onClick={() => onClose?.()}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ================== 2. TEMPLATE MANAGER ================== */
const TemplateManagerSection = ({ onTemplateChanged }) => {
  const { pushToast, setLoading } = useUIStore()
  const { user } = useAuthStore()
  const toast = (type, message) => pushToast?.(type, message)

  const [templates, setTemplates] = useState([])
  const [form, setForm] = useState(() => createDefaultForm())
  const [editingId, setEditingId] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    loadTemplates()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('templat_sertifikat_publik')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error

      const normalized = (data || []).map(normalizeTemplate)

      const resolved = await Promise.all(
        normalized.map(async (t) => {
          const rawBg = t.background_url || ''
          let bgUrl = ''
          try {
            bgUrl = await createSignedUrlWithFallbackBuckets(CERT_TEMPLATE_BUCKET_FALLBACKS, rawBg)
          } catch {
            bgUrl = isHttpUrl(rawBg) ? rawBg : ''
          }
          const bgType = getTemplateBackgroundType(rawBg)
          let previewUrl = bgUrl
          if (bgType === 'pdf' && bgUrl) {
            try {
              previewUrl = await renderPdfFirstPageToDataUrl(bgUrl)
            } catch {
              previewUrl = ''
            }
          }
          return { ...t, __bgUrl: bgUrl, __bgType: bgType, __previewUrl: previewUrl }
        })
      )

      setTemplates(resolved)
      return resolved
    } catch (err) {
      toast('error', err.message || 'Gagal memuat template')
      return []
    }
  }

  const updateField = (fieldName, key, val) => {
    setForm((prev) => ({
      ...prev,
      fields: {
        ...prev.fields,
        [fieldName]: { ...prev.fields[fieldName], [key]: val }
      }
    }))
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setLoading?.(true)

    try {
      let finalBgPath = form.backgroundPath || ''

      if (form.backgroundFile) {
        const fileError = validateTemplateFile(form.backgroundFile)
        if (fileError) throw new Error(fileError)

        const ext = (form.backgroundFile.name.split('.').pop() || 'png').toLowerCase()
        const fname = `templates/${editingId || 'NEW'}/${nowIsoCompact()}_${Math.random().toString(16).slice(2)}.${ext}`

        const { error: upErr } = await supabase.storage.from(CERT_TEMPLATE_BUCKET).upload(fname, form.backgroundFile, {
          cacheControl: '3600',
          upsert: false
        })
        if (upErr) throw upErr

        finalBgPath = fname
      }

      if (!finalBgPath) throw new Error('Background wajib diupload')

      // Mapping balik ke kolom legacy supaya kompatibel dengan data lama
      const fNama = form.fields?.nama || defaultFields.nama
      const fEvent = form.fields?.event || defaultFields.event
      const fTanggal = form.fields?.tanggal || defaultFields.tanggal

      const savedFields = cloneTemplateFields(form.fields)

      const payload = {
        nama: form.nama,
        deskripsi: form.deskripsi,
        background_url: finalBgPath, // isi PATH
        fields: savedFields,
        is_active: true,
        // legacy columns
        text_color: fNama.color || '#000000',
        font_family: fNama.fontFamily || 'Helvetica',
        font_size: Number.isFinite(fNama.fontSize) ? fNama.fontSize : 24,
        nama_x: Math.round(fNama.x ?? A4_WIDTH / 2),
        nama_y: Math.round(fNama.y ?? 260),
        event_x: Math.round(fEvent.x ?? A4_WIDTH / 2),
        event_y: Math.round(fEvent.y ?? 310),
        tanggal_x: Math.round(fTanggal.x ?? A4_WIDTH / 2),
        tanggal_y: Math.round(fTanggal.y ?? 380),
        updated_at: new Date().toISOString()
      }

      if (editingId) {
        const { error } = await supabase.from('templat_sertifikat_publik').update(payload).eq('id', editingId)
        if (error) throw error
        toast('success', 'Template berhasil diperbarui')
      } else {
        const ins = { ...payload, created_by: user?.id || null, created_at: new Date().toISOString() }
        const { error } = await supabase.from('templat_sertifikat_publik').insert(ins)
        if (error) throw error
        toast('success', 'Template baru berhasil disimpan')
      }

      const refreshedTemplates = await loadTemplates()
      const savedTemplate = refreshedTemplates.find((t) =>
        editingId
          ? t.id === editingId
          : t.background_url === finalBgPath && t.nama === form.nama
      )

      setForm((prev) => ({
        ...prev,
        backgroundPath: finalBgPath,
        backgroundFile: null,
        backgroundType: getTemplateBackgroundType(finalBgPath),
        fields: savedFields
      }))
      if (savedTemplate?.id) setEditingId(savedTemplate.id)
      if (fileInputRef.current) fileInputRef.current.value = ''

      onTemplateChanged?.()
    } catch (err) {
      console.error(err)
      toast('error', err.message || 'Gagal menyimpan template')
    } finally {
      setLoading?.(false)
    }
  }

  const handleEdit = async (t) => {
    setEditingId(t.id)

    const nt = normalizeTemplate(t)
    const rawBg = nt.background_url || ''
    let previewUrl = ''
    const backgroundType = nt.__bgType || getTemplateBackgroundType(rawBg)
    try {
      const signedUrl = await createSignedUrlWithFallbackBuckets(CERT_TEMPLATE_BUCKET_FALLBACKS, rawBg)
      previewUrl = backgroundType === 'pdf' ? await renderPdfFirstPageToDataUrl(signedUrl) : signedUrl
    } catch {
      if (isHttpUrl(rawBg) && backgroundType === 'pdf') {
        try {
          previewUrl = await renderPdfFirstPageToDataUrl(rawBg)
        } catch {
          previewUrl = ''
        }
      } else {
        previewUrl = isHttpUrl(rawBg) ? rawBg : ''
      }
    }

    setForm({
      nama: nt.nama,
      deskripsi: nt.deskripsi || '',
      backgroundPath: rawBg,
      previewUrl,
      backgroundFile: null,
      backgroundType,
      fields: nt.fields
    })
  }

  const handleDelete = async (id) => {
    if (!confirm('Hapus template ini?')) return
    try {
      const { error } = await supabase.from('templat_sertifikat_publik').delete().eq('id', id)
      if (error) throw error
      await loadTemplates()
      onTemplateChanged?.()
      toast('success', 'Template terhapus')
    } catch (err) {
      toast('error', err.message || 'Gagal menghapus template')
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-140px)] min-h-[600px]">
      {/* LEFT */}
      <div className="lg:w-[400px] flex flex-col bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex-shrink-0">
        <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
          <h2 className="font-bold text-gray-800">{editingId ? '✏️ Edit Template' : '➕ Template Baru'}</h2>
          <button
            onClick={() => {
              setForm(createDefaultForm())
              setEditingId(null)
              if (fileInputRef.current) fileInputRef.current.value = ''
            }}
            className="text-xs text-red-600 hover:underline"
          >
            Reset
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <form onSubmit={handleSave} className="space-y-6">
            {/* BASIC */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Nama Template</label>
                <input
                  required
                  className="w-full px-3 py-2 border rounded text-sm focus:ring-1 focus:ring-blue-500"
                  value={form.nama}
                  onChange={(e) => setForm((prev) => ({ ...prev, nama: e.target.value }))}
                  placeholder="Contoh: Sertifikat Lomba Coding"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Deskripsi (opsional)</label>
                <textarea
                  className="w-full px-3 py-2 border rounded text-sm focus:ring-1 focus:ring-blue-500 resize-none"
                  rows={2}
                  value={form.deskripsi}
                  onChange={(e) => setForm((prev) => ({ ...prev, deskripsi: e.target.value }))}
                  placeholder="Deskripsi singkat template ini..."
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Upload Background (PDF/PNG/JPG - A4 Landscape)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="block w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  accept={TEMPLATE_UPLOAD_ACCEPT}
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    const fileError = validateTemplateFile(f)
                    if (fileError) {
                      toast('error', fileError)
                      e.target.value = ''
                      return
                    }

                    setLoading?.(true)
                    try {
                      const previewUrl = await resolveTemplateBackgroundDataUrl(f)
                      setForm((prev) => ({
                        ...prev,
                        backgroundFile: f,
                        backgroundType: getTemplateBackgroundType(f),
                        previewUrl
                      }))
                    } catch (err) {
                      toast('error', err.message || 'Gagal membuat preview template')
                      e.target.value = ''
                    } finally {
                      setLoading?.(false)
                    }
                  }}
                />
                {form.backgroundPath && !isHttpUrl(form.backgroundPath) && (
                  <p className="text-[10px] text-gray-500 mt-1">
                    Storage key: <span className="font-mono">{form.backgroundPath}</span>
                  </p>
                )}
              </div>
            </div>

            <hr className="border-dashed" />

            {/* FIELD CONFIG */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Field Konfigurasi</label>
                <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500">
                  Koordinat pt (A4: 842 × 595)
                </span>
              </div>

              {Object.keys(form.fields).map((key) => {
                const f = form.fields[key]
                return (
                  <div
                    key={key}
                    className={`border rounded-lg transition-all duration-200 ${
                      f.active ? 'bg-white border-blue-300 shadow-sm' : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <div className="p-3 flex justify-between items-center bg-gray-50/50 border-b">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={f.active}
                          onChange={(e) => updateField(key, 'active', e.target.checked)}
                          className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                        <span className="font-bold text-sm text-gray-700 capitalize">{f.label || key}</span>
                      </div>
                      {f.active && (
                        <span className="text-[10px] font-mono text-gray-400 text-right">
                          x:{f.x} | y:{f.y} | size:{f.fontSize}
                        </span>
                      )}
                    </div>

                    {f.active && (
                      <div className="p-3 space-y-3">
                        <div>
                          <label className="block text-[10px] font-semibold text-blue-600 mb-1">📝 Teks Simulasi</label>
                          <input
                            type="text"
                            className="w-full px-2 py-1.5 border border-blue-200 rounded text-sm bg-blue-50/30 focus:bg-white focus:ring-1 focus:ring-blue-500 transition-colors"
                            value={f.simulationText || ''}
                            onChange={(e) => updateField(key, 'simulationText', e.target.value)}
                            placeholder={`Contoh isi ${key}...`}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-gray-400 mb-0.5">Font Family</label>
                            <select
                              className="w-full text-xs border rounded px-1 py-1"
                              value={f.fontFamily}
                              onChange={(e) => updateField(key, 'fontFamily', e.target.value)}
                            >
                              {FONT_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-400 mb-0.5">Warna</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                className="w-6 h-6 rounded border p-0 cursor-pointer overflow-hidden"
                                value={f.color}
                                onChange={(e) => updateField(key, 'color', e.target.value)}
                              />
                              <span className="text-[10px] text-gray-500 font-mono">{f.color}</span>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] text-gray-400 mb-0.5">Style</label>
                            <select
                              className="w-full text-xs border rounded px-1 py-1"
                              value={f.fontStyle}
                              onChange={(e) => updateField(key, 'fontStyle', e.target.value)}
                            >
                              {FONT_STYLE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-400 mb-0.5">Format</label>
                            <select
                              className="w-full text-xs border rounded px-1 py-1"
                              value={f.textTransform}
                              onChange={(e) => updateField(key, 'textTransform', e.target.value)}
                            >
                              <option value="none">Normal</option>
                              <option value="uppercase">UPPERCASE</option>
                              <option value="capitalize">Capitalize</option>
                              <option value="lowercase">lowercase</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-400 mb-0.5">Garis</label>
                            <select
                              className="w-full text-xs border rounded px-1 py-1"
                              value={f.textDecoration || 'none'}
                              onChange={(e) => updateField(key, 'textDecoration', e.target.value)}
                            >
                              {TEXT_DECORATION_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="bg-gray-50 p-2 rounded border border-gray-100 space-y-2">
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] w-10 text-gray-500">Size</label>
                            <input
                              type="range"
                              min="8"
                              max="120"
                              value={f.fontSize}
                              onChange={(e) => updateField(key, 'fontSize', parseInt(e.target.value, 10))}
                              className="flex-1 h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                            />
                            <input
                              type="number"
                              value={f.fontSize}
                              onChange={(e) => updateField(key, 'fontSize', parseInt(e.target.value, 10) || 10)}
                              className="w-14 text-xs border rounded text-center py-0.5"
                            />
                          </div>

                          <div className="flex items-center gap-2">
                            <label className="text-[10px] w-10 text-gray-500">Pos X</label>
                            <input
                              type="range"
                              min="0"
                              max={A4_WIDTH}
                              value={f.x}
                              onChange={(e) => updateField(key, 'x', parseInt(e.target.value, 10))}
                              className="flex-1 h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                            />
                            <input
                              type="number"
                              value={f.x}
                              onChange={(e) => updateField(key, 'x', parseInt(e.target.value, 10) || 0)}
                              className="w-16 text-xs border rounded text-center py-0.5"
                            />
                          </div>

                          <div className="flex items-center gap-2">
                            <label className="text-[10px] w-10 text-gray-500">Pos Y</label>
                            <input
                              type="range"
                              min="0"
                              max={A4_HEIGHT}
                              value={f.y}
                              onChange={(e) => updateField(key, 'y', parseInt(e.target.value, 10))}
                              className="flex-1 h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                            />
                            <input
                              type="number"
                              value={f.y}
                              onChange={(e) => updateField(key, 'y', parseInt(e.target.value, 10) || 0)}
                              className="w-16 text-xs border rounded text-center py-0.5"
                            />
                          </div>

                          <p className="text-[10px] text-gray-400 mt-1">
                            Y = posisi baseline teks (0 di atas, {A4_HEIGHT} di bawah). Koordinat ini sama dengan PDF.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="pt-4 pb-10">
              <button
                type="submit"
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 shadow-md transition-all"
              >
                💾 Simpan Template
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* RIGHT */}
      <div className="flex-1 flex flex-col gap-6 overflow-hidden">
        {/* PREVIEW SVG */}
        <div className="flex-1 bg-gray-100 rounded-xl border border-gray-300 shadow-inner relative flex items-center justify-center p-6 overflow-hidden">
          <div className="absolute top-4 left-4 bg-gray-800 text-white text-xs px-3 py-1 rounded-full opacity-80 pointer-events-none z-20">
            A4 Landscape (842 × 595) preview
          </div>

          <div
            className="relative bg-white shadow-2xl border border-gray-200"
            style={{
              width: `${A4_WIDTH}px`,
              height: `${A4_HEIGHT}px`,
              transform: 'scale(0.75)',
              transformOrigin: 'center center'
            }}
          >
            <CertificateLayoutPreview
              backgroundUrl={form.previewUrl}
              fields={form.fields}
              className="h-full w-full"
              emptyLabel="Upload background untuk memulai desain template"
              showEmptyIcon
            />
          </div>
        </div>

        {/* TEMPLATE LIST */}
        <div className="h-48 bg-white border border-gray-200 rounded-xl flex flex-col shadow-sm">
          <div className="px-4 py-2 bg-gray-50 border-b text-xs font-bold text-gray-500 uppercase tracking-wide">
            Daftar Template Tersimpan
          </div>

          <div className="flex-1 overflow-x-auto p-4 whitespace-nowrap custom-scrollbar flex gap-4 items-center">
            {templates.length === 0 && (
              <span className="text-sm text-gray-400 mx-auto">Belum ada template. Buat template pertama Anda.</span>
            )}

            {templates.map((t) => (
              <div
                key={t.id}
                className="inline-block w-48 group relative border rounded-lg overflow-hidden hover:shadow-md transition-all bg-white"
              >
                <div className="h-24 bg-gray-100 relative">
                  <CertificateLayoutPreview
                    backgroundUrl={t.__previewUrl || t.__bgUrl}
                    fields={t.fields}
                    className="h-full w-full opacity-90 transition-opacity group-hover:opacity-100"
                    emptyLabel="BG tidak bisa dimuat"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                </div>

                <div className="p-3">
                  <div className="font-bold text-sm text-gray-800 truncate mb-1">{t.nama}</div>
                  {t.deskripsi && <p className="text-[11px] text-gray-500 mb-2 line-clamp-2">{t.deskripsi}</p>}

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(t)}
                      className="flex-1 bg-yellow-50 text-yellow-700 text-xs py-1.5 rounded border border-yellow-200 hover:bg-yellow-100"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="flex-1 bg-red-50 text-red-700 text-xs py-1.5 rounded border border-red-200 hover:bg-red-100"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ================== 3. HISTORY SECTION ================== */
const HistorySection = () => {
  const [data, setData] = useState([])
  const [meta, setMeta] = useState({ page: 1, per_page: 50, total: 0, page_count: 1, from: 0, to: 0 })
  const [downloadingId, setDownloadingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [sendingEmailId, setSendingEmailId] = useState(null)
  const { pushToast } = useUIStore()
  const toast = (type, message) => pushToast?.(type, message)

  const load = async (page = meta.page || 1) => {
    const { data, error } = await supabase.admin.certificates({ page, per_page: 50 })

    if (error) throw error
    setData(data?.rows || [])
    setMeta(data?.meta || { page, per_page: 50, total: data?.rows?.length || 0, page_count: 1, from: 0, to: data?.rows?.length || 0 })
  }

  useEffect(() => {
    let alive = true
    load()
      .catch(() => {})
      .finally(() => {
        if (!alive) return
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDownload = async (row) => {
    setDownloadingId(row.id)
    try {
      const fileUrl = row.file_url
      if (!fileUrl) throw new Error('File tidak ditemukan')

      const signed = await createSignedUrlWithFallbackBuckets(CERT_BUCKET_FALLBACKS, fileUrl)
      if (!signed) throw new Error('Gagal membuat signed URL')

      window.open(signed, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast('error', err.message || 'Gagal download')
    } finally {
      setDownloadingId(null)
    }
  }

  const handleSendEmail = async (row) => {
    setSendingEmailId(row.id)
    try {
      const res = await apiFetch(`/api/admin/certificates/${row.id}/send-email`, {
        method: 'POST'
      })
      if (res.error) throw res.error
      toast('success', 'Email sertifikat berhasil dikirim!')
      await load()
    } catch (err) {
      toast('error', err.message || 'Gagal mengirim email')
    } finally {
      setSendingEmailId(null)
    }
  }

  const handleDelete = async (row) => {
    if (!confirm('Hapus sertifikat ini?')) return
    setDeletingId(row.id)
    try {
      // Hapus DB dulu (RLS admin)
      const { error } = await supabase.from('certificates').delete().eq('id', row.id)
      if (error) throw error

      // Best effort: hapus file storage kalau file_url itu path
      if (row.file_url && !isHttpUrl(row.file_url)) {
        for (const bucket of CERT_BUCKET_FALLBACKS) {
          const objectPath = extractObjectPath(bucket, row.file_url) || String(row.file_url || '')
          if (!objectPath) continue
          try {
            await supabase.storage.from(bucket).remove([objectPath])
          } catch {
            // ignore fallback errors
          }
        }
      }

      setData((p) => p.filter((x) => x.id !== row.id))
      toast('success', 'Sertifikat terhapus')
    } catch (err) {
      toast('error', err.message || 'Gagal menghapus sertifikat')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow border overflow-hidden">
      <div className="p-4 border-b bg-gray-50">
        <h3 className="font-bold text-gray-700">Riwayat Sertifikat</h3>
        <p className="text-xs text-gray-500 mt-1">
          Menampilkan {meta.from || 0}-{meta.to || data.length} dari {meta.total || data.length} sertifikat. Download memakai signed URL cache.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-white text-gray-500 border-b">
            <tr>
              <th className="p-4 font-medium">Tanggal Dibuat</th>
              <th className="p-4 font-medium">Nomor</th>
              <th className="p-4 font-medium">Nama Penerima</th>
              <th className="p-4 font-medium">Event</th>
              <th className="p-4 font-medium text-center">Status Email</th>
              <th className="p-4 font-medium text-center">File</th>
              <th className="p-4 font-medium text-center">Aksi</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-50">
            {data.map((d) => (
              <tr key={d.id} className="hover:bg-blue-50/50 transition-colors">
                <td className="p-4 text-gray-600">
                  {d.issued_at ? new Date(d.issued_at).toLocaleDateString('id-ID') : '-'}
                </td>
                <td className="p-4">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold text-slate-700">
                    {d.certificate_number || '-'}
                  </span>
                </td>
                <td className="p-4 font-semibold text-gray-800">{d.nama_penerima}</td>
                <td className="p-4 text-gray-600">{d.event}</td>

                <td className="p-4 text-center">
                  {d.email_sent ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                      ✅ Terkirim
                    </span>
                  ) : d.email_error ? (
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200 cursor-help"
                      title={d.email_error}
                    >
                      ❌ Gagal: {d.email_error}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-50 text-gray-500 border border-gray-200">
                      ⏳ Belum Dikirim
                    </span>
                  )}
                </td>

                <td className="p-4 text-center">
                  <button
                    onClick={() => handleDownload(d)}
                    disabled={downloadingId === d.id}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-medium hover:bg-blue-100 disabled:opacity-60"
                  >
                    {downloadingId === d.id ? '⏳ Membuka...' : '⬇ Download'}
                  </button>
                </td>

                <td className="p-4 text-center">
                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={() => handleSendEmail(d)}
                      disabled={sendingEmailId === d.id || deletingId === d.id || downloadingId === d.id}
                      className="text-gray-400 hover:text-blue-600 transition-colors disabled:opacity-60"
                      title="Kirim Ulang Email"
                    >
                      {sendingEmailId === d.id ? (
                        <svg className="animate-spin h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={() => handleDelete(d)}
                      disabled={deletingId === d.id || sendingEmailId === d.id}
                      className="text-gray-400 hover:text-red-600 transition-colors disabled:opacity-60"
                      title="Hapus"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {data.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-gray-400 text-sm">
                  Belum ada sertifikat yang dibuat.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {meta.total > 0 && (
        <div className="flex items-center justify-between gap-3 border-t bg-gray-50 px-4 py-3 text-sm">
          <span className="text-gray-500">Halaman {meta.page || 1} / {meta.page_count || 1}</span>
          <div className="flex gap-2">
            <button
              onClick={() => load(Math.max(1, (meta.page || 1) - 1))}
              disabled={(meta.page || 1) <= 1}
              className="rounded-lg border bg-white px-3 py-1.5 font-medium text-gray-700 disabled:opacity-50"
            >
              Sebelumnya
            </button>
            <button
              onClick={() => load(Math.min(meta.page_count || 1, (meta.page || 1) + 1))}
              disabled={(meta.page || 1) >= (meta.page_count || 1)}
              className="rounded-lg border bg-white px-3 py-1.5 font-medium text-gray-700 disabled:opacity-50"
            >
              Berikutnya
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminSertifikat
