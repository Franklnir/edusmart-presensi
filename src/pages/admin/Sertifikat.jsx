// src/pages/admin/Sertifikat.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  supabase,
  CERT_BUCKET as APP_CERT_BUCKET,
  CERT_TEMPLATE_BUCKET as APP_CERT_TEMPLATE_BUCKET,
  extractObjectPath
} from '../../lib/supabase'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'

// ================== KONFIGURASI BUCKET ==================
const CERT_BUCKET = APP_CERT_BUCKET
const CERT_TEMPLATE_BUCKET = APP_CERT_TEMPLATE_BUCKET
const CERT_BUCKET_FALLBACKS = Array.from(new Set([CERT_BUCKET, 'sertifikat-files']))
const CERT_TEMPLATE_BUCKET_FALLBACKS = Array.from(new Set([CERT_TEMPLATE_BUCKET, 'sertifikat-templates']))

// A4 landscape size (points)
const A4_WIDTH = 842
const A4_HEIGHT = 595

// Signed URL expiry (seconds)
const SIGNED_EXPIRES = 60 * 60 * 24 * 7 // 7 hari

/* ================== jsPDF Lazy Load ================== */
let jsPDFInstance = null
const loadJsPDF = async () => {
  if (jsPDFInstance) return jsPDFInstance
  const mod = await import('jspdf')
  jsPDFInstance = mod.default
  return jsPDFInstance
}

/* ================== FONT UTILS ================== */
const FONT_OPTIONS = [
  { value: 'Helvetica', label: 'Helvetica / Arial' },
  { value: 'Times', label: 'Times New Roman' },
  { value: 'Courier', label: 'Courier New' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Garamond', label: 'Garamond' },
  { value: 'Roboto', label: 'Roboto' },
  { value: 'Poppins', label: 'Poppins' }
]

const getPdfFont = (fontFamily) => {
  const f = (fontFamily || '').toLowerCase()
  if (f.includes('courier')) return 'courier'
  if (f.includes('times') || f.includes('georgia') || f.includes('garamond')) return 'times'
  return 'helvetica'
}

const getCssFontFamily = (fontFamily) => {
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
const clamp = (n, min, max) => Math.min(Math.max(n, min), max)
const uniqueNonEmpty = (values = []) =>
  Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))

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
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now())
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

const createSignedUrl = async (bucket, pathOrUrl) => {
  if (!pathOrUrl) return ''
  if (isHttpUrl(pathOrUrl)) return pathOrUrl

  const candidates = uniqueNonEmpty([
    extractObjectPath(bucket, pathOrUrl),
    pathOrUrl
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
      credentials: 'include'
    })
    return response.ok
  } catch {
    return false
  }
}

const createSignedUrlWithFallbackBuckets = async (buckets, pathOrUrl) => {
  if (!pathOrUrl) return ''
  if (isHttpUrl(pathOrUrl)) return pathOrUrl

  let lastError = null
  let fallbackSignedUrl = ''
  for (const bucket of buckets) {
    try {
      const signed = await createSignedUrl(bucket, pathOrUrl)
      if (!signed) continue
      if (!fallbackSignedUrl) fallbackSignedUrl = signed
      // eslint-disable-next-line no-await-in-loop
      if (await canAccessSignedUrl(signed)) return signed
    } catch (error) {
      lastError = error
    }
  }

  if (fallbackSignedUrl) return fallbackSignedUrl
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
    simulationText: '29 November 2025'
  },
  nomor: {
    label: 'No. Sertifikat',
    x: A4_WIDTH / 2,
    y: 450,
    active: false,
    fontSize: 12,
    fontStyle: 'normal',
    color: '#000000',
    fontFamily: 'Courier',
    textTransform: 'none',
    simulationText: 'NO: 123/SERT/XI/2025'
  }
}

const buildFieldsFromLegacyTemplate = (t) => {
  // gunakan legacy posisi + font dasar, tetap konsisten dengan defaultFields
  const baseColor = t?.text_color || '#000000'
  const baseFamily = t?.font_family || 'Helvetica'
  const baseSize = Number.isFinite(t?.font_size) ? t.font_size : 24

  const merged = { ...defaultFields }
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

const normalizeTemplate = (t) => {
  const merged = { ...defaultFields }

  const hasFields =
    t?.fields &&
    typeof t.fields === 'object' &&
    !Array.isArray(t.fields) &&
    Object.keys(t.fields).length > 0

  const sourceFields = hasFields ? t.fields : buildFieldsFromLegacyTemplate(t)

  Object.keys(sourceFields || {}).forEach((k) => {
    merged[k] = { ...merged[k], ...(sourceFields[k] || {}) }
  })

  return {
    ...t,
    fields: merged
  }
}

const defaultForm = {
  nama: '',
  deskripsi: '',
  backgroundPath: '', // kita simpan ke background_url (isi path, bukan public url)
  backgroundFile: null,
  previewUrl: '',
  fields: defaultFields
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
          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-600 rounded-xl shadow-sm text-white text-2xl">🎓</div>
              <div>
                <h1 className="page-title-heading">Certificate Pro</h1>
                <p className="page-title-description">Admin Dashboard Sertifikat</p>
              </div>
            </div>

            <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200">
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
        const [tplRes, klsRes, eksRes] = await Promise.all([
          supabase
            .from('templat_sertifikat_publik')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false }),
          supabase.from('kelas').select('*').order('nama'),
          supabase.from('ekskul').select('id, nama').order('nama')
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
            return { ...t, __bgUrl: bgUrl }
          })
        )

        setTemplateList(resolved)
        if (resolved.length > 0) setSelectedTemplateId(resolved[0].id)

        setKelasList(klsRes.data || [])
        setEskulList(eksRes.data || [])
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

  const loadPeserta = async () => {
    setLoading?.(true)
    setPeserta([])
    try {
      let rows = []

      if (role === 'ekskul') {
        if (!ekskulFilter) throw new Error('Pilih eskul terlebih dahulu')

        const { data: memberRows, error: memberErr } = await supabase
          .from('ekskul_anggota')
          .select('user_id')
          .eq('ekskul_id', ekskulFilter)

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
      if (!field?.active) return

      let text = ''
      if (key === 'nama') text = data.nama || ''
      else if (key === 'event') text = data.event || ''
      else if (key === 'tanggal') text = data.dateDisplay || ''
      else if (key === 'nomor') text = data.nomor || `NO: ${Math.floor(Math.random() * 10000)}/SERT/${new Date().getFullYear()}`

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
    })
  }

  const handleProcess = async (isPreview = false) => {
    if (!selectedTemplate || !eventName?.trim()) {
      toast('warning', 'Nama event & template wajib diisi')
      return
    }

    setIsProcessing(true)
    setProgressStatus('')

    try {
      const jsPDF = await loadJsPDF()

      const bgUrl = selectedTemplate.__bgUrl || ''
      const bgDataUrl = bgUrl ? await fetchImageAsDataUrl(bgUrl) : null

      const dateDisplay = new Date(eventDate).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })

      const targets = isPreview
        ? [
            {
              id: 'preview',
              nama: selectedTemplate.fields?.nama?.simulationText || 'Contoh Nama Peserta',
              event: eventName.trim(),
              dateDisplay,
              nomor: selectedTemplate.fields?.nomor?.simulationText || ''
            }
          ]
        : peserta
            .filter((p) => selectedIds.includes(p.id))
            .map((p) => ({
              ...p,
              event: eventName.trim(),
              dateDisplay
            }))

      if (targets.length === 0) throw new Error('Pilih minimal satu peserta')

      let success = 0
      const eventFolder = safeSlug(eventName)
      const baseFolder = `certs/${eventFolder}/${eventDate}`

      for (let i = 0; i < targets.length; i++) {
        const p = targets[i]
        if (!isPreview) setProgressStatus(`Memproses ${i + 1}/${targets.length}: ${p.nama}`)

        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
        const w = doc.internal.pageSize.getWidth()
        const h = doc.internal.pageSize.getHeight()

        await generatePdf({ doc, data: p, template: selectedTemplate, bgDataUrl, width: w, height: h })

        if (isPreview) {
          doc.save(`PREVIEW - ${eventName}.pdf`)
          break
        }

        const blob = doc.output('blob')
        const filePath = `${baseFolder}/${nowIsoCompact()}_${p.id}.pdf`

        const { error: upErr } = await supabase.storage.from(CERT_BUCKET).upload(filePath, blob, {
          cacheControl: '3600',
          contentType: 'application/pdf',
          upsert: false
        })
        if (upErr) throw upErr

        // IMPORTANT: schema kamu cuma punya file_url (NOT NULL)
        // Kita simpan "path" ke file_url, lalu download pakai signed URL.
        const { error: insErr } = await supabase.from('certificates').insert({
          user_id: p.id,
          nama_penerima: p.nama,
          email: p.email || null,
          kelas: p.kelas || null,
          event: eventName.trim(),
          event_date: eventDate,
          file_url: filePath,
          sent: true,
          sent_at: new Date().toISOString()
        })
        if (insErr) throw insErr

        success++
      }

      if (!isPreview) {
        toast('success', `${success} sertifikat berhasil dibuat`)
        await loadPeserta()
      } else {
        toast('success', 'Preview PDF berhasil diunduh')
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

            <button
              onClick={() => handleProcess(true)}
              disabled={!eventName?.trim() || !selectedTemplate}
              className="w-full py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors mt-2 flex items-center justify-center gap-2"
            >
              👁️ Lihat Preview PDF
            </button>

            <p className="text-xs text-gray-500 leading-relaxed">
              File disimpan di storage, lalu <span className="font-semibold">file_url</span> di DB berisi path.
              Download pakai signed URL.
            </p>
          </div>
        </div>

        {selectedTemplate && (
          <div className="bg-white p-4 rounded-xl border shadow-sm">
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide text-center">
              Preview Template (background)
            </p>
            <div className="relative aspect-[842/595] rounded overflow-hidden border bg-gray-100">
              {selectedTemplate.__bgUrl ? (
                <img src={selectedTemplate.__bgUrl} alt="bg" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                  Background tidak bisa dimuat (cek path/izin storage).
                </div>
              )}
            </div>
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
              className="px-3 py-1.5 border rounded-lg text-sm bg-gray-50"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="siswa">Siswa</option>
              <option value="guru">Guru</option>
              <option value="ekskul">Anggota Eskul</option>
            </select>

            {role === 'siswa' && (
              <select
                className="px-3 py-1.5 border rounded-lg text-sm bg-gray-50"
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
                className="px-3 py-1.5 border rounded-lg text-sm bg-gray-50"
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

        <div className="flex-1 overflow-auto rounded-lg border border-gray-200 mb-4">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="p-3 w-12 text-center border-b">
                  <input
                    type="checkbox"
                    className="rounded text-blue-600 focus:ring-blue-500"
                    onChange={() =>
                      setSelectedIds(selectedIds.length === peserta.length ? [] : peserta.map((p) => p.id))
                    }
                    checked={peserta.length > 0 && selectedIds.length === peserta.length}
                  />
                </th>
                <th className="p-3 text-left font-semibold text-gray-700 border-b">Nama Lengkap</th>
                <th className="p-3 text-left font-semibold text-gray-700 border-b">Info / Kelas</th>
                <th className="p-3 text-left font-semibold text-gray-700 border-b">Email</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100">
              {peserta.map((p) => (
                <tr key={p.id} className="hover:bg-blue-50/60 transition-colors">
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      className="rounded text-blue-600 focus:ring-blue-500"
                      checked={selectedIds.includes(p.id)}
                      onChange={() =>
                        setSelectedIds((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))
                      }
                    />
                  </td>
                  <td className="p-3 font-medium text-gray-900">{p.nama}</td>
                  <td className="p-3 text-gray-500">{p.kelas || p.jabatan || p.__recipientInfo || '-'}</td>
                  <td className="p-3 text-gray-400">{p.email}</td>
                </tr>
              ))}

              {peserta.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-12 text-center text-gray-400 italic">
                    Klik tombol &quot;Muat Data&quot; untuk menampilkan daftar peserta
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
              <>🚀 Buat Sertifikat untuk {selectedIds.length} Peserta Terpilih</>
            )}
          </button>
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
  const [form, setForm] = useState(defaultForm)
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
          return { ...t, __bgUrl: bgUrl }
        })
      )

      setTemplates(resolved)
    } catch (err) {
      toast('error', err.message || 'Gagal memuat template')
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

      const payload = {
        nama: form.nama,
        deskripsi: form.deskripsi,
        background_url: finalBgPath, // isi PATH
        fields: form.fields,
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

      setForm(defaultForm)
      setEditingId(null)
      if (fileInputRef.current) fileInputRef.current.value = ''

      await loadTemplates()
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
    try {
      previewUrl = await createSignedUrlWithFallbackBuckets(CERT_TEMPLATE_BUCKET_FALLBACKS, rawBg)
    } catch {
      previewUrl = isHttpUrl(rawBg) ? rawBg : ''
    }

    setForm({
      nama: nt.nama,
      deskripsi: nt.deskripsi || '',
      backgroundPath: rawBg,
      previewUrl,
      backgroundFile: null,
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
              setForm(defaultForm)
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
                <label className="block text-xs font-semibold text-gray-500 mb-1">Upload Background (A4 Landscape)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="block w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    const local = URL.createObjectURL(f)
                    setForm((prev) => ({
                      ...prev,
                      backgroundFile: f,
                      previewUrl: local
                    }))
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

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-gray-400 mb-0.5">Style</label>
                            <select
                              className="w-full text-xs border rounded px-1 py-1"
                              value={f.fontStyle}
                              onChange={(e) => updateField(key, 'fontStyle', e.target.value)}
                            >
                              <option value="normal">Normal</option>
                              <option value="bold">Bold</option>
                              <option value="italic">Italic</option>
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
            {form.previewUrl ? (
              <svg width={A4_WIDTH} height={A4_HEIGHT} viewBox={`0 0 ${A4_WIDTH} ${A4_HEIGHT}`}>
                <image href={form.previewUrl} x="0" y="0" width={A4_WIDTH} height={A4_HEIGHT} preserveAspectRatio="none" />

                {Object.keys(form.fields).map((key) => {
                  const f = form.fields[key]
                  if (!f.active) return null
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
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <span className="text-4xl mb-2">🖼️</span>
                <span className="font-medium">Upload background untuk memulai desain template</span>
              </div>
            )}
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
                  {t.__bgUrl ? (
                    <img
                      src={t.__bgUrl}
                      className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                      alt={t.nama}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">BG tidak bisa dimuat</div>
                  )}
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
  const [downloadingId, setDownloadingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const { pushToast } = useUIStore()
  const toast = (type, message) => pushToast?.(type, message)

  const load = async () => {
    const { data, error } = await supabase
      .from('certificates')
      .select('*')
      .order('issued_at', { ascending: false })
      .limit(50)

    if (error) throw error
    setData(data || [])
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
        <h3 className="font-bold text-gray-700">Riwayat 50 Sertifikat Terakhir</h3>
        <p className="text-xs text-gray-500 mt-1">
          Kolom <span className="font-mono">file_url</span> menyimpan path storage atau URL. Download selalu via signed URL.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-white text-gray-500 border-b">
            <tr>
              <th className="p-4 font-medium">Tanggal Dibuat</th>
              <th className="p-4 font-medium">Nama Penerima</th>
              <th className="p-4 font-medium">Event</th>
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
                <td className="p-4 font-semibold text-gray-800">{d.nama_penerima}</td>
                <td className="p-4 text-gray-600">{d.event}</td>

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
                  <button
                    onClick={() => handleDelete(d)}
                    disabled={deletingId === d.id}
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
                </td>
              </tr>
            ))}

            {data.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-gray-400 text-sm">
                  Belum ada sertifikat yang dibuat.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default AdminSertifikat
