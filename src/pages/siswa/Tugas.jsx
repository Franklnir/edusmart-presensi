// src/pages/siswa/TugasSiswa.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, ImagePlus, Images } from 'lucide-react'
import {
  supabase,
  ASSIGNMENT_BUCKET,
  extractObjectPath,
  getSignedUrlForValue
} from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import FileDropzone from '../../components/FileDropzone'
import FilePreviewModal from '../../components/FilePreviewModal'
import PhotoGalleryModal from '../../components/PhotoGalleryModal'
import UploadProgressTrain from '../../components/UploadProgressTrain'
import AcademicPeriodArchiveFilter from '../../components/AcademicPeriodArchiveFilter'
import useActiveAcademicPeriod from '../../hooks/useActiveAcademicPeriod'
import { parseSupabaseError } from '../../utils/supabaseError'
import {
  ASSIGNMENT_PHOTO_MAX_BYTES,
  ASSIGNMENT_PHOTOS_MAX_TOTAL_BYTES,
  MAX_ASSIGNMENT_PHOTOS,
  isImageLikeFile,
  normalizePhotoFiles,
  parseAssignmentFileList
} from '../../utils/assignmentFiles'
import {
  createAggregateProgress,
  getResponsiveUploadConcurrency,
  runConcurrentQueue
} from '../../utils/uploadQueue'

/* =========================
   Constants & Helpers
========================= */
const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
]

const STATUS_FILTER_VALUES = new Set(['all', 'belum', 'menunggu', 'dinilai'])
const TIME_RANGE_VALUES = new Set(['recent', 'week', 'all', 'custom_months'])
const DEFAULT_TASK_LIST_LIMIT = 10
const TUGAS_LIST_COLUMNS = 'id, kelas, judul, mapel, mulai, deadline, keterangan, file_url, link, created_at, updated_at'
const TUGAS_MAPEL_COLUMNS = 'mapel'
const TUGAS_JAWABAN_LIST_COLUMNS = 'tugas_id, user_id, nilai, status, file_url, file_urls, link_url, komentar_siswa, waktu_submit'
const MAPEL_CACHE_TTL_MS = 5 * 60 * 1000

const normalizeStatusFilter = (value) => (
  STATUS_FILTER_VALUES.has(value) ? value : ''
)

const normalizeTimeRange = (value) => (
  TIME_RANGE_VALUES.has(value) ? value : ''
)

const parseSortTime = (value) => {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

const compareNewestTask = (a, b) => {
  const createdDiff = parseSortTime(b?.created_at || b?.updated_at) - parseSortTime(a?.created_at || a?.updated_at)
  if (createdDiff !== 0) return createdDiff
  return parseSortTime(b?.deadline) - parseSortTime(a?.deadline)
}

const sortTasksByNewest = (tasks = []) => [...tasks].sort(compareNewestTask)

const normalizeMapelOptions = (rows = []) =>
  Array.from(
    new Set(
      (rows || [])
        .map((row) => String(row?.mapel || '').trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, 'id'))

const buildMapelCacheKey = (userId, kelas) =>
  `siswa:tugas:mapel:${userId || 'anon'}:${kelas || '-'}`

const readMapelOptionsCache = (userId, kelas) => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(buildMapelCacheKey(userId, kelas))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > MAPEL_CACHE_TTL_MS) return null
    return Array.isArray(parsed.items) ? parsed.items : null
  } catch {
    return null
  }
}

const writeMapelOptionsCache = (userId, kelas, items) => {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(
      buildMapelCacheKey(userId, kelas),
      JSON.stringify({ savedAt: Date.now(), items })
    )
  } catch {
    // Cache ini hanya optimasi UX; kalau storage penuh, halaman tetap jalan normal.
  }
}

const FILE_SIZE_LIMITS = {
  IMAGE: ASSIGNMENT_PHOTO_MAX_BYTES,
  PDF: 3 * 1024 * 1024,
  DOCUMENT: 3 * 1024 * 1024,
  SPREADSHEET: 3 * 1024 * 1024,
  PRESENTATION: 5 * 1024 * 1024
}

const ASSIGNMENT_FILE_ACCEPT = {
  'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.oasis.opendocument.text': ['.odt'],
  'application/rtf': ['.rtf'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.oasis.opendocument.presentation': ['.odp']
}

const uploadToneForProvider = (provider) => {
  if (provider === 'google_drive') return 'emerald'
  if (provider === 'object_storage') return 'purple'
  if (provider === 'local') return 'red'
  return 'blue'
}

const uploadDetailForProvider = (provider, fallback) => {
  if (provider === 'google_drive') return 'File sedang dikirim ke Google Drive sekolah.'
  if (provider === 'object_storage') return 'File dikirim langsung ke object storage sekolah.'
  if (provider === 'local') return 'File sedang dikirim ke VPS.'
  return fallback
}

const MIN_UPLOAD_ANIMATION_MS = 250
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const holdUploadAnimation = async (startedAt) => {
  const remaining = MIN_UPLOAD_ANIMATION_MS - (Date.now() - startedAt)
  if (remaining > 0) await wait(remaining)
}
const ASSIGNMENT_FAST_UPLOAD_OPTIONS = {
  upsert: false,
  cacheControl: '3600',
  skipDrive: true
}

const looksLikeDomainUrl = (v = '') => /^[a-z0-9-]+(\.[a-z0-9-]+)+(?::\d+)?(\/|$)/i.test(String(v || '').trim())

const hasUsableValue = (value = '') => {
  const raw = String(value || '').trim()
  if (!raw) return false
  const normalized = raw.toLowerCase()
  return !['null', 'undefined', '-', 'n/a'].includes(normalized)
}

const getFirstAttachmentValue = (fileUrls, fallback = '') => (
  parseAssignmentFileList(fileUrls, fallback).find((item) => !isImageLikeFile(item)) || ''
)

const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime())

const formatDateTime = (dateString) => {
  if (!dateString) return '-'
  const d = new Date(dateString)
  if (!isValidDate(d)) return '-'
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatFileSize = (bytes) => {
  if (!bytes) return '0 B'
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i]
}

const sanitizeFileName = (name = 'file') => {
  const base = String(name || 'file')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 80)
  return base || 'file'
}

const getFileExt = (nameOrUrl = '') => {
  const raw = String(nameOrUrl || '').split('?')[0]
  const parts = raw.split('.')
  if (parts.length < 2) return ''
  return parts.pop()?.toLowerCase() || ''
}

const guessIfImage = (nameOrUrl = '') => {
  const ext = getFileExt(nameOrUrl)
  return ['jpeg', 'jpg', 'png', 'gif', 'webp', 'bmp'].includes(ext)
}

const buildLast12Months = () => {
  const now = new Date()
  const items = []
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = `${MONTH_NAMES_ID[d.getMonth()]} ${d.getFullYear()}`
    items.push({ value: ym, label })
  }
  return items
}

const NEAR_DEADLINE_HOURS = 24

const getTaskWindowInfo = (mulai, deadline, now = new Date()) => {
  const mulaiDate = mulai ? new Date(mulai) : null
  const deadlineDate = deadline ? new Date(deadline) : null

  const isBeforeStart = mulaiDate ? isValidDate(mulaiDate) && now < mulaiDate : false
  const isExpired = deadlineDate ? isValidDate(deadlineDate) && now > deadlineDate : false
  const isNearDeadline =
    deadlineDate && isValidDate(deadlineDate) && !isExpired
      ? deadlineDate.getTime() - now.getTime() <= NEAR_DEADLINE_HOURS * 60 * 60 * 1000
      : false

  return {
    isBeforeStart,
    isExpired,
    isNearDeadline
  }
}

const getSubmitLockReason = (tugas, myJawaban, myStatus) => {
  if (!tugas) return ''
  if (myJawaban?.nilai != null || myStatus === 'dinilai') {
    return 'Jawaban sudah dinilai, tidak bisa dikumpulkan ulang'
  }
  if (tugas.isBeforeStart) {
    return 'Tugas belum dimulai'
  }
  if (tugas.isExpired) {
    return 'Deadline sudah lewat, tidak bisa mengumpulkan'
  }
  return ''
}

/* =========================
   Compression Helpers
========================= */
const compressImage = async (file, maxSizeKB = 100, initialQuality = 0.9) => {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) {
      reject(new Error('File bukan gambar'))
      return
    }

    if (file.size <= maxSizeKB * 1024) {
      resolve(file)
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas tidak didukung'))
          return
        }

        let width = img.width
        let height = img.height
        let quality = initialQuality

        const step = () => {
          canvas.width = width
          canvas.height = height
          ctx.clearRect(0, 0, width, height)
          ctx.drawImage(img, 0, 0, width, height)

          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Gagal mengkompresi gambar'))
                return
              }

              const currentKB = blob.size / 1024
              if (currentKB > maxSizeKB && quality > 0.3) {
                quality -= 0.1
                width = Math.floor(width * 0.85)
                height = Math.floor(height * 0.85)

                if (width < 100 || height < 100) {
                  const compressed = new File([blob], file.name, {
                    type: file.type,
                    lastModified: Date.now()
                  })
                  resolve(compressed)
                  return
                }
                step()
              } else {
                const compressed = new File([blob], file.name, {
                  type: file.type,
                  lastModified: Date.now()
                })
                resolve(compressed)
              }
            },
            file.type,
            quality
          )
        }

        step()
      }
      img.onerror = () => reject(new Error('Gagal memuat gambar'))
      img.src = event.target?.result
    }
    reader.onerror = () => reject(new Error('Gagal membaca file'))
    reader.readAsDataURL(file)
  })
}

const enforceMaxBytes = (file, maxBytes, label) => {
  if (file.size <= maxBytes) return file
  const maxMB = Math.round((maxBytes / (1024 * 1024)) * 100) / 100
  throw new Error(`File ${label} terlalu besar (${formatFileSize(file.size)}). Maksimal ${maxMB}MB.`)
}

const compressFileBeforeUpload = async (file) => {
  const fileType = file?.type || ''
  const fileName = (file?.name || '').toLowerCase()

  if (fileType.startsWith('image/')) {
    return await compressImage(file, FILE_SIZE_LIMITS.IMAGE / 1024)
  }

  if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
    return enforceMaxBytes(file, FILE_SIZE_LIMITS.PDF, 'PDF')
  }

  if (fileType.includes('spreadsheet') || fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
    return enforceMaxBytes(file, FILE_SIZE_LIMITS.SPREADSHEET, 'spreadsheet')
  }

  if (fileType.includes('presentation') || fileName.endsWith('.ppt') || fileName.endsWith('.pptx')) {
    return enforceMaxBytes(file, FILE_SIZE_LIMITS.PRESENTATION, 'presentasi')
  }

  if (
    fileType.includes('document') ||
    fileName.endsWith('.doc') ||
    fileName.endsWith('.docx') ||
    fileName.endsWith('.odt') ||
    fileName.endsWith('.rtf')
  ) {
    return enforceMaxBytes(file, FILE_SIZE_LIMITS.DOCUMENT, 'dokumen')
  }

  throw new Error(
    'Tipe file tidak didukung. Gunakan gambar (JPG/PNG), PDF/Dokumen, Spreadsheet, atau PPT.'
  )
}

/* =========================
   Storage Helpers
========================= */
const extractObjectKeyFromAny = (value) => extractObjectPath(ASSIGNMENT_BUCKET, value || '')
const isGoogleDriveUrl = (value = '') => /^https?:\/\/(?:drive|docs)\.google\.com\//i.test(String(value || '').trim())

const createSignedUrlForKey = async (keyOrUrl, expiresInSeconds = 60 * 60) => {
  if (!keyOrUrl) return null
  const key = extractObjectKeyFromAny(keyOrUrl)
  if (!key) {
    if (/^https?:\/\//i.test(String(keyOrUrl || ''))) return String(keyOrUrl)
    throw new Error('Path file tidak valid')
  }
  return getSignedUrlForValue(ASSIGNMENT_BUCKET, key, expiresInSeconds)
}

/**
 * ANTI-IDOR:
 * - siswa upload jawaban hanya ke folder: <tugas_id>/<siswa_id>-<ts>.<ext>
 * - siswa boleh delete hanya jawaban miliknya sendiri (folder tugas yang sama, dan prefix siswa_id-)
 */
const deleteJawabanFileFromStorage = async (fileKeyOrUrl, tugasId, userId) => {
  const raw = String(fileKeyOrUrl || '').trim()
  if (isGoogleDriveUrl(raw)) {
    const { error } = await supabase.storage.from(ASSIGNMENT_BUCKET).remove([raw])
    if (error) throw error
    return
  }

  const key = extractObjectKeyFromAny(fileKeyOrUrl)
  if (!key) return

  const parts = key.split('/')
  const folderTugas = parts[0]
  const filename = parts.slice(1).join('/')

  if (folderTugas !== String(tugasId)) {
    throw new Error('Akses tidak diizinkan untuk menghapus file ini')
  }

  if (!filename.startsWith(`${userId}-`)) {
    throw new Error('Akses tidak diizinkan untuk menghapus file ini')
  }

  const { error } = await supabase.storage.from(ASSIGNMENT_BUCKET).remove([key])
  if (error) throw error
}

/* =========================
   UI Bits
========================= */
function StatusBadge({ status }) {
  const normalized = String(status || '').toLowerCase()
  const map = {
    belum: { text: 'Belum', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
    menunggu: { text: 'Menunggu Nilai', cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    dinilai: { text: 'Dinilai', cls: 'bg-green-100 text-green-800 border-green-200' }
  }
  const pick = map[normalized] || map.belum
  return (
    <span className={`px-3 py-1 rounded-full border text-xs font-bold ${pick.cls}`}>
      {pick.text}
    </span>
  )
}

function ScoreBadge({ nilai }) {
  if (nilai == null) return null
  return (
    <span className="px-3 py-1 rounded-full border bg-blue-100 text-blue-800 border-blue-200 text-xs font-bold">
      Nilai: {nilai}
    </span>
  )
}

function MiniCard({ title, value, icon, cls }) {
  return (
    <div className={`rounded-2xl border p-4 ${cls}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs opacity-80">{title}</div>
          <div className="text-2xl font-extrabold">{value}</div>
        </div>
        <div className="text-2xl">{icon}</div>
      </div>
    </div>
  )
}

/* =========================
   Main Component
========================= */
export default function TugasSiswa() {
  const { user, profile } = useAuthStore()
  const { loading, pushToast, setLoading } = useUIStore()
  const {
    activeAcademicPeriod,
    period,
    periodFilter,
    academicYearOptions,
    semesterOptions,
    setAcademicYear,
    setSemester,
    resetToActivePeriod,
    applyPeriodFilters,
    academicPeriodPayload,
    isViewingArchivePeriod
  } = useActiveAcademicPeriod({
    storageKey: 'edusmart.siswa.tugas.periodFilter'
  })
  const [searchParams] = useSearchParams()
  const requestedTugasId = String(searchParams.get('tugas') || '').trim()

  /* ---------- State ---------- */
  const [tugasList, setTugasList] = useState([])
  const [selectedMapel, setSelectedMapel] = useState('')
  const [mapelOptions, setMapelOptions] = useState([])
  const [isMapelLoading, setIsMapelLoading] = useState(false)
  const [isListLoading, setIsListLoading] = useState(false)

  const [timeRange, setTimeRange] = useState(() => (
    requestedTugasId ? 'all' : normalizeTimeRange(searchParams.get('range')) || 'recent'
  )) // recent | week | all | custom_months
  const [selectedMonths, setSelectedMonths] = useState([])
  const [statusFilter, setStatusFilter] = useState(() => (
    normalizeStatusFilter(searchParams.get('status')) || 'all'
  )) // all | belum | menunggu | dinilai
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')

  useEffect(() => {
    if (isViewingArchivePeriod && ['recent', 'week'].includes(timeRange)) {
      setTimeRange('all')
    }
  }, [isViewingArchivePeriod, timeRange])

  const [selectedTugas, setSelectedTugas] = useState(null)
  const [detail, setDetail] = useState(null)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)

  const [jawabanFileKey, setJawabanFileKey] = useState('')
  const [jawabanFileSize, setJawabanFileSize] = useState('')
  const [jawabanPhotoValues, setJawabanPhotoValues] = useState([])
  const [jawabanPhotoSizes, setJawabanPhotoSizes] = useState([])
  const [jawabanLink, setJawabanLink] = useState('')
  const [jawabanKomentar, setJawabanKomentar] = useState('')

  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [uploadPercent, setUploadPercent] = useState(null)
  const [answerUploadProvider, setAnswerUploadProvider] = useState(null)
  const [pendingJawabanFile, setPendingJawabanFile] = useState(null)
  const [pendingJawabanPhotos, setPendingJawabanPhotos] = useState([])
  const [uploadSuccessNotice, setUploadSuccessNotice] = useState(null)

  const [previewFile, setPreviewFile] = useState(null)
  const [photoGallery, setPhotoGallery] = useState(null)

  const autoOpenedTugasIdRef = useRef('')
  const galleryInputRef = useRef(null)
  const listRequestSeqRef = useRef(0)
  const mapelRequestSeqRef = useRef(0)
  const successNoticeTimerRef = useRef(null)
  const uploadAbortRef = useRef(null)

  /* ---------- Derived ---------- */
  const monthOptions = useMemo(() => (
    (period.months || []).map((month) => ({
      value: month.value,
      label: month.label
    }))
  ), [period.months])

  const kelasSiswa = useMemo(() => profile?.kelas || profile?.kelas_id || '', [profile])
  const selectedKelas = kelasSiswa

  const showUploadSuccessNotice = useCallback((title, detailText = '') => {
    if (successNoticeTimerRef.current) clearTimeout(successNoticeTimerRef.current)
    setUploadSuccessNotice({
      id: Date.now(),
      title,
      detail: detailText
    })
    successNoticeTimerRef.current = setTimeout(() => {
      setUploadSuccessNotice(null)
      successNoticeTimerRef.current = null
    }, 3200)
  }, [])

  useEffect(() => {
    return () => {
      if (successNoticeTimerRef.current) clearTimeout(successNoticeTimerRef.current)
      uploadAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim())
    }, 350)
    return () => window.clearTimeout(timer)
  }, [searchTerm])

  const hasActiveTaskFilter = useMemo(() => (
    Boolean(
      selectedMapel ||
      statusFilter !== 'all' ||
      debouncedSearchTerm.trim() ||
      timeRange !== 'recent' ||
      isViewingArchivePeriod
    )
  ), [selectedMapel, statusFilter, debouncedSearchTerm, timeRange, isViewingArchivePeriod])

  useEffect(() => {
    const nextStatus = normalizeStatusFilter(searchParams.get('status'))
    const nextRange = normalizeTimeRange(searchParams.get('range'))

    if (nextStatus && nextStatus !== statusFilter) setStatusFilter(nextStatus)
    if (requestedTugasId && timeRange !== 'all') {
      setTimeRange('all')
    } else if (!requestedTugasId && nextRange && nextRange !== timeRange) {
      setTimeRange(nextRange)
    }
  }, [requestedTugasId, searchParams, statusFilter, timeRange])

  /* =========================
     Load Tugas List
     ANTI-IDOR:
     - siswa hanya baca tugas berdasarkan kelasnya sendiri
     - siswa hanya baca jawaban miliknya sendiri pada tugas_jawaban (RLS harus enforce)
========================= */
  const loadMapelOptions = useCallback(async () => {
    if (!user?.id) return
    const kelas = selectedKelas || kelasSiswa
    if (!kelas) return

    const requestId = ++mapelRequestSeqRef.current
    const cached = readMapelOptionsCache(user.id, kelas)
    if (cached && requestId === mapelRequestSeqRef.current) {
      setMapelOptions(cached)
    }

    try {
      setIsMapelLoading(true)
      let tugasQuery = supabase
        .from('tugas')
        .select(TUGAS_MAPEL_COLUMNS)
        .eq('kelas', kelas)
        .order('mapel', { ascending: true })
      tugasQuery = applyPeriodFilters(tugasQuery)

      let jadwalQuery = supabase
        .from('jadwal')
        .select('mapel')
        .eq('kelas_id', kelas)
        .order('mapel', { ascending: true })
      jadwalQuery = applyPeriodFilters(jadwalQuery)

      const [
        { data: tugasMapelData, error },
        { data: jadwalMapelData, error: jadwalError }
      ] = await Promise.all([tugasQuery, jadwalQuery])

      if (error) throw error
      if (jadwalError) {
        console.warn('Gagal memuat mapel jadwal tugas siswa:', jadwalError)
      }
      if (requestId !== mapelRequestSeqRef.current) return

      const mapels = normalizeMapelOptions([...(jadwalMapelData || []), ...(tugasMapelData || [])])
      setMapelOptions(mapels)
      writeMapelOptionsCache(user.id, kelas, mapels)
    } catch (error) {
      if (requestId !== mapelRequestSeqRef.current) return
      console.warn('Gagal memuat opsi mapel tugas:', error)
    } finally {
      if (requestId === mapelRequestSeqRef.current) {
        setIsMapelLoading(false)
      }
    }
  }, [applyPeriodFilters, user?.id, selectedKelas, kelasSiswa])

  const loadTugasList = useCallback(async () => {
    if (!user?.id) return
    const kelas = selectedKelas || kelasSiswa
    if (!kelas) return
    const requestId = ++listRequestSeqRef.current

    try {
      setIsListLoading(true)
      const now = new Date()

      // tugas untuk kelas siswa
      let query = supabase.from('tugas').select(TUGAS_LIST_COLUMNS).eq('kelas', kelas)
      query = applyPeriodFilters(query)
      const normalizedSearch = debouncedSearchTerm.trim().toLowerCase()

      if (selectedMapel) query = query.eq('mapel', selectedMapel)

      if (timeRange === 'week') {
        const weekAgo = new Date(now)
        weekAgo.setDate(now.getDate() - 7)
        query = query.gte('created_at', weekAgo.toISOString())
      } else if (timeRange === 'all') {
        if (period.startsAt && period.endsAt) {
          const start = new Date(`${period.startsAt}T00:00:00`)
          const end = new Date(`${period.endsAt}T00:00:00`)
          end.setDate(end.getDate() + 1)
          query = query.gte('created_at', start.toISOString()).lt('created_at', end.toISOString())
        }
      } else if (timeRange === 'custom_months') {
        if (selectedMonths.length > 0) {
          let minYear = Infinity
          let minMonth = Infinity
          let maxYear = -Infinity
          let maxMonth = -Infinity

          selectedMonths.forEach((ym) => {
            const [ys, ms] = ym.split('-')
            const y = parseInt(ys, 10)
            const m = parseInt(ms, 10)
            if (!Number.isNaN(y) && !Number.isNaN(m)) {
              if (y < minYear || (y === minYear && m < minMonth)) {
                minYear = y
                minMonth = m
              }
              if (y > maxYear || (y === maxYear && m > maxMonth)) {
                maxYear = y
                maxMonth = m
              }
            }
          })

          if (minYear !== Infinity) {
            const start = new Date(minYear, minMonth - 1, 1)
            const end = new Date(maxYear, maxMonth, 1)
            query = query.gte('created_at', start.toISOString()).lt('created_at', end.toISOString())
          }
        }
      }

      query = query.order('created_at', { ascending: false })
      if (!hasActiveTaskFilter) query = query.limit(DEFAULT_TASK_LIST_LIMIT)
      const { data: tugasData, error } = await query
      if (error) throw error
      if (requestId !== listRequestSeqRef.current) return

      let tugasArr = sortTasksByNewest(tugasData || [])

      if (normalizedSearch) {
        tugasArr = tugasArr.filter((t) => (
          String(t.judul || '').toLowerCase().includes(normalizedSearch) ||
          String(t.mapel || '').toLowerCase().includes(normalizedSearch) ||
          String(t.keterangan || '').toLowerCase().includes(normalizedSearch)
        ))
      }

      if (timeRange === 'custom_months' && selectedMonths.length > 0) {
        const setMonths = new Set(selectedMonths)
        tugasArr = tugasArr.filter((t) => {
          if (!t.created_at) return false
          const d = new Date(t.created_at)
          if (!isValidDate(d)) return false
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          return setMonths.has(ym)
        })
      }

      if (tugasArr.length === 0) {
        setTugasList([])
        return
      }

      // ambil jawaban milik siswa ini untuk tugas-tugas tersebut
      const tugasIds = tugasArr.map((t) => t.id)
      let jawabanQuery = supabase
        .from('tugas_jawaban')
        .select(TUGAS_JAWABAN_LIST_COLUMNS)
        .eq('user_id', user.id)
        .in('tugas_id', tugasIds)
      jawabanQuery = applyPeriodFilters(jawabanQuery)
      const { data: jawabanData, error: jErr } = await jawabanQuery

      if (jErr) throw jErr
      if (requestId !== listRequestSeqRef.current) return

      const jawabanArr = jawabanData || []
      const jawabanByTugas = jawabanArr.reduce((acc, j) => {
        acc[j.tugas_id] = j
        return acc
      }, {})

      let merged = tugasArr.map((t) => {
        const j = jawabanByTugas[t.id]
        const nowRef = new Date()
        const windowInfo = getTaskWindowInfo(t.mulai, t.deadline, nowRef)

        const normalizedStatus = j?.nilai != null ? 'dinilai' : j ? 'menunggu' : 'belum'

        return {
          ...t,
          isExpired: windowInfo.isExpired,
          isBeforeStart: windowInfo.isBeforeStart,
          isNearDeadline: windowInfo.isNearDeadline,
          myJawaban: j || null,
          myStatus: normalizedStatus
        }
      })

      if (statusFilter !== 'all') {
        merged = merged.filter((t) => t.myStatus === statusFilter)
      }

      merged = sortTasksByNewest(merged)
      setTugasList(hasActiveTaskFilter ? merged : merged.slice(0, DEFAULT_TASK_LIST_LIMIT))
    } catch (error) {
      if (requestId !== listRequestSeqRef.current) return
      console.error('Error load tugas list:', error)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal memuat tugas: ${parsed.message}`)
    } finally {
      if (requestId === listRequestSeqRef.current) {
        setIsListLoading(false)
      }
    }
  }, [
    applyPeriodFilters,
    user?.id,
    selectedKelas,
    kelasSiswa,
    selectedMapel,
    timeRange,
    selectedMonths,
    period.endsAt,
    period.startsAt,
    statusFilter,
    debouncedSearchTerm,
    hasActiveTaskFilter,
    pushToast
  ])

  useEffect(() => {
    if (!user?.id) return
    void loadMapelOptions()
  }, [user?.id, loadMapelOptions])

  useEffect(() => {
    if (user?.id) void loadTugasList()
  }, [user?.id, loadTugasList])

  useEffect(() => {
    if (!selectedMapel || isMapelLoading) return
    if (mapelOptions.length > 0 && !mapelOptions.includes(selectedMapel)) {
      setSelectedMapel('')
    }
  }, [selectedMapel, mapelOptions, isMapelLoading])

  /* Reset months when range changes */
  useEffect(() => {
    if (timeRange !== 'custom_months') setSelectedMonths([])
  }, [timeRange])

  /* =========================
     Detail modal
========================= */
  const openDetail = async (tugas) => {
    if (!tugas || !user?.id) return

    // ANTI-IDOR: siswa hanya boleh buka tugas kelasnya
    const kelas = selectedKelas || kelasSiswa
    if (tugas.kelas !== kelas) {
      pushToast('error', 'Akses ditolak: tugas bukan untuk kelas Anda')
      return
    }

    setSelectedTugas(tugas)
    setDetail(null)
    setJawabanFileKey('')
    setJawabanFileSize('')
    setJawabanPhotoValues(
      parseAssignmentFileList(tugas?.myJawaban?.file_urls, tugas?.myJawaban?.file_url).filter(isImageLikeFile)
    )
    setJawabanPhotoSizes([])
    setJawabanLink(tugas?.myJawaban?.link_url || '')
    setJawabanKomentar(tugas?.myJawaban?.komentar_siswa || '')
    setUploadProgress(null)
    setAnswerUploadProvider(null)
    setPendingJawabanFile(null)
    setPendingJawabanPhotos([])

    try {
      setIsLoadingDetail(true)

      // ambil data tugas terbaru (optional, biar sinkron)
      let tugasQuery = supabase
        .from('tugas')
        .select(TUGAS_LIST_COLUMNS)
        .eq('id', tugas.id)
        .single()
      tugasQuery = applyPeriodFilters(tugasQuery)
      const { data: tugasData, error: tErr } = await tugasQuery

      if (tErr) throw tErr

      // ambil jawaban milik siswa untuk tugas ini
      let jawabanQuery = supabase
        .from('tugas_jawaban')
        .select('id, tugas_id, user_id, file_url, file_urls, link_url, komentar_siswa, nilai, status, waktu_submit')
        .eq('tugas_id', tugas.id)
        .eq('user_id', user.id)
        .maybeSingle()
      jawabanQuery = applyPeriodFilters(jawabanQuery)
      const { data: jawabanData, error: jErr } = await jawabanQuery

      if (jErr) throw jErr

      const windowInfo = getTaskWindowInfo(tugasData?.mulai, tugasData?.deadline, new Date())

      const myStatus =
        jawabanData?.nilai != null ? 'dinilai' : jawabanData ? 'menunggu' : 'belum'

      setDetail({
        tugas: {
          ...tugasData,
          isExpired: windowInfo.isExpired,
          isBeforeStart: windowInfo.isBeforeStart,
          isNearDeadline: windowInfo.isNearDeadline
        },
        myJawaban: jawabanData || null,
        myStatus
      })

      // set current answer assets; galeri foto dan lampiran biasa dipisah di UI
      const existingFiles = parseAssignmentFileList(jawabanData?.file_urls, jawabanData?.file_url)
      const existingPhotos = existingFiles.filter(isImageLikeFile)
      const existingAttachment = existingFiles.find((item) => !isImageLikeFile(item)) || ''
      setJawabanPhotoValues(existingPhotos)
      setJawabanPhotoSizes(existingPhotos.map(() => `maks ${formatFileSize(ASSIGNMENT_PHOTO_MAX_BYTES)}`))
      setJawabanKomentar(jawabanData?.komentar_siswa || '')

      setJawabanFileKey(existingAttachment)

      // fetch file size
      if (existingAttachment) {
        try {
          const signed = await createSignedUrlForKey(existingAttachment, 60 * 10)
          if (signed) {
            const res = await fetch(signed)
            if (res.ok) {
              const blob = await res.blob()
              setJawabanFileSize(formatFileSize(blob.size))
            }
          }
        } catch (e) {
          console.warn('Gagal ambil ukuran file:', e)
        }
      }
    } catch (error) {
      console.error('Error open detail:', error)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal memuat detail tugas: ${parsed.message}`)
      setSelectedTugas(null)
    } finally {
      setIsLoadingDetail(false)
    }
  }

  useEffect(() => {
    if (!requestedTugasId || !user?.id || autoOpenedTugasIdRef.current === requestedTugasId) return
    const targetedTask = tugasList.find((item) => String(item.id) === requestedTugasId)
    if (!targetedTask) return

    autoOpenedTugasIdRef.current = requestedTugasId
    void openDetail(targetedTask)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTugasId, tugasList, user?.id])

  useEffect(() => {
    if (selectedTugas) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [selectedTugas])

  const discardPendingJawabanFile = useCallback(async () => {
    const pendingValue = pendingJawabanFile?.value
    const pendingPhotoValues = pendingJawabanPhotos.map((item) => item?.value).filter(Boolean)
    if ((!pendingValue && pendingPhotoValues.length === 0) || !selectedTugas?.id || !user?.id) return

    try {
      const values = Array.from(new Set([pendingValue, ...pendingPhotoValues].filter(Boolean)))
      await Promise.all(values.map((value) => deleteJawabanFileFromStorage(value, selectedTugas.id, user.id)))
    } catch (error) {
      console.warn('Gagal menghapus file/foto jawaban sementara:', error)
    } finally {
      setPendingJawabanFile(null)
      setPendingJawabanPhotos([])
    }
  }, [pendingJawabanFile?.value, pendingJawabanPhotos, selectedTugas?.id, user?.id])

  const closeDetail = useCallback(async () => {
    await discardPendingJawabanFile()
    setSelectedTugas(null)
    setPendingJawabanFile(null)
    setPendingJawabanPhotos([])
    setAnswerUploadProvider(null)
  }, [discardPendingJawabanFile])

  /* =========================
     Upload / Delete jawaban
========================= */
  const handleUploadJawabanFile = async (files) => {
    if (!files?.length || !user?.id || !selectedTugas) return
    const file = files[0]
    const animationStartedAt = Date.now()
    let uploadController = null

    // ANTI-IDOR: siswa hanya upload untuk tugas yang sedang dibuka
    const kelas = selectedKelas || kelasSiswa
    if (selectedTugas.kelas !== kelas) {
      pushToast('error', 'Akses ditolak: tugas bukan untuk kelas Anda')
      return
    }

    const lockReason = getSubmitLockReason(detail?.tugas, detail?.myJawaban, detail?.myStatus)
    if (lockReason) {
      pushToast('error', lockReason)
      return
    }

    try {
      uploadAbortRef.current?.abort()
      uploadController = new AbortController()
      uploadAbortRef.current = uploadController
      setIsUploading(true)
      setAnswerUploadProvider(null)
      setUploadPercent(null)
      setUploadProgress('Mengkompresi file...')

      const compressed = await compressFileBeforeUpload(file)

      const safeName = sanitizeFileName(compressed.name)
      const filePath = `${selectedTugas.id}/${user.id}-${Date.now()}-${safeName}`

      setUploadProgress('Mengupload file lewat jalur cepat...')

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(ASSIGNMENT_BUCKET)
        .upload(filePath, compressed, {
          ...ASSIGNMENT_FAST_UPLOAD_OPTIONS,
          signal: uploadController.signal,
          onProgress: setUploadPercent
        })

      if (uploadError) throw new Error(uploadError.message)

      const storedFileValue = uploadData?.path || uploadData?.fullPath || filePath
      const sizeLabel = uploadData?.uploadedSizeLabel || formatFileSize(uploadData?.uploadedSizeBytes || compressed.size)
      const storedProvider = ['google_drive', 'object_storage'].includes(uploadData?.provider)
        ? uploadData.provider
        : 'local'
      setAnswerUploadProvider(storedProvider)

      const oldPendingFile = pendingJawabanFile?.value
      if (oldPendingFile && oldPendingFile !== storedFileValue) {
        try {
          await deleteJawabanFileFromStorage(oldPendingFile, selectedTugas.id, user.id)
        } catch (e) {
          console.warn('Gagal hapus file jawaban sementara:', e)
        }
      }
      if (pendingJawabanPhotos.length > 0) {
        await Promise.allSettled(
          pendingJawabanPhotos
            .map((item) => item?.value)
            .filter(Boolean)
            .map((value) => deleteJawabanFileFromStorage(value, selectedTugas.id, user.id))
        )
      }

      setJawabanFileKey(storedFileValue)
      setJawabanFileSize(sizeLabel)
      setJawabanPhotoValues([])
      setJawabanPhotoSizes([])
      setPendingJawabanFile({ value: storedFileValue, sizeLabel, provider: storedProvider })
      setPendingJawabanPhotos([])
      setUploadProgress(null)

      pushToast('success', `File jawaban berhasil diupload (${sizeLabel})`)
      showUploadSuccessNotice('File jawaban siap', 'Tambahkan komentar bila perlu, lalu klik Kirim Jawaban.')
    } catch (error) {
      console.error('Upload jawaban error:', error)
      setUploadProgress(null)
      setUploadPercent(null)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal upload file: ${parsed.message}`)
    } finally {
      await holdUploadAnimation(animationStartedAt)
      setIsUploading(false)
      setAnswerUploadProvider(null)
      setUploadPercent(null)
      if (uploadAbortRef.current === uploadController) {
        uploadAbortRef.current = null
      }
    }
  }

  const handleUploadJawabanPhotos = async (inputFiles) => {
    if (!inputFiles?.length || !user?.id || !selectedTugas) return
    const files = normalizePhotoFiles(inputFiles)
    const animationStartedAt = Date.now()
    let uploaded = []
    let uploadController = null

    if (files.length === 0) {
      pushToast('error', 'Pilih file foto dari galeri perangkat.')
      return
    }

    if (files.length > MAX_ASSIGNMENT_PHOTOS) {
      pushToast('error', `Maksimal ${MAX_ASSIGNMENT_PHOTOS} foto untuk satu tugas.`)
      return
    }

    const kelas = selectedKelas || kelasSiswa
    if (selectedTugas.kelas !== kelas) {
      pushToast('error', 'Akses ditolak: tugas bukan untuk kelas Anda')
      return
    }

    const lockReason = getSubmitLockReason(detail?.tugas, detail?.myJawaban, detail?.myStatus)
    if (lockReason) {
      pushToast('error', lockReason)
      return
    }

    try {
      uploadAbortRef.current?.abort()
      uploadController = new AbortController()
      uploadAbortRef.current = uploadController
      setIsUploading(true)
      setAnswerUploadProvider(null)
      setUploadPercent(null)
      setUploadProgress(`Menyiapkan ${files.length} foto...`)

      const concurrency = getResponsiveUploadConcurrency({ max: 3 })
      const updateAggregateProgress = createAggregateProgress(files.length, setUploadPercent)
      setUploadProgress(`Mengupload ${files.length} foto lewat jalur cepat...`)

      uploaded = []
      const uploadedResults = await runConcurrentQueue(files, async (file, i) => {
        const compressed = await compressImage(file, ASSIGNMENT_PHOTO_MAX_BYTES / 1024)
        updateAggregateProgress(i, 8)
        const safeName = sanitizeFileName(compressed.name || `foto-${i + 1}.jpg`)
        const filePath = `${selectedTugas.id}/${user.id}-${Date.now()}-${i + 1}-${safeName}`

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from(ASSIGNMENT_BUCKET)
          .upload(filePath, compressed, {
            ...ASSIGNMENT_FAST_UPLOAD_OPTIONS,
            signal: uploadController.signal,
            onProgress: (progress) => updateAggregateProgress(i, progress)
          })

        if (uploadError) throw new Error(uploadError.message)
        updateAggregateProgress(i, 100)

        const storedFileValue = uploadData?.path || uploadData?.fullPath || filePath
        const sizeLabel = uploadData?.uploadedSizeLabel || formatFileSize(uploadData?.uploadedSizeBytes || compressed.size)
        const storedProvider = ['google_drive', 'object_storage'].includes(uploadData?.provider)
          ? uploadData.provider
          : 'local'
        const item = { value: storedFileValue, sizeLabel, provider: storedProvider }
        uploaded.push(item)
        return item
      }, {
        concurrency,
        onError: () => uploadController.abort()
      })
      uploaded = uploadedResults.filter(Boolean)
      const hasDriveUpload = uploaded.some((item) => item.provider === 'google_drive')
      const hasObjectStorageUpload = uploaded.some((item) => item.provider === 'object_storage')
      setAnswerUploadProvider(hasDriveUpload ? 'google_drive' : hasObjectStorageUpload ? 'object_storage' : 'local')

      const stalePending = [
        pendingJawabanFile?.value,
        ...pendingJawabanPhotos.map((item) => item?.value)
      ].filter(Boolean)
      if (stalePending.length > 0) {
        await Promise.allSettled(
          stalePending.map((value) => deleteJawabanFileFromStorage(value, selectedTugas.id, user.id))
        )
      }

      const values = uploaded.map((item) => item.value)
      setJawabanPhotoValues(values)
      setJawabanPhotoSizes(uploaded.map((item) => item.sizeLabel))
      setJawabanFileKey('')
      setJawabanFileSize('')
      setPendingJawabanFile(null)
      setPendingJawabanPhotos(uploaded)
      setUploadProgress(null)

      pushToast('success', `${values.length} foto berhasil diupload. Klik Kirim Jawaban untuk menyimpan.`)
      showUploadSuccessNotice(`${values.length} foto siap`, 'Tambahkan komentar bila perlu, lalu klik Kirim Jawaban.')
    } catch (error) {
      console.error('Upload foto jawaban error:', error)
      if (uploaded.length > 0) {
        await Promise.allSettled(
          uploaded
            .map((item) => item?.value)
            .filter(Boolean)
            .map((value) => deleteJawabanFileFromStorage(value, selectedTugas.id, user.id))
        )
      }
      setUploadProgress(null)
      setUploadPercent(null)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal upload foto: ${parsed.message}`)
    } finally {
      await holdUploadAnimation(animationStartedAt)
      setIsUploading(false)
      setAnswerUploadProvider(null)
      setUploadPercent(null)
      if (uploadAbortRef.current === uploadController) {
        uploadAbortRef.current = null
      }
      if (galleryInputRef.current) galleryInputRef.current.value = ''
    }
  }

  const handleDeleteJawabanFile = async () => {
    if (!user?.id || !selectedTugas) return
    const targetFile = currentAttachmentValue
    if (!targetFile) return

    const lockReason = getSubmitLockReason(detail?.tugas, detail?.myJawaban, detail?.myStatus)
    if (lockReason) {
      pushToast('error', lockReason)
      return
    }

    // eslint-disable-next-line no-restricted-globals
    if (!confirm('Hapus file jawaban ini?')) return

    const pendingValues = Array.from(new Set([
      pendingJawabanFile?.value
    ].filter(Boolean)))
    const isOnlyPending = pendingValues.includes(targetFile)

    if (isOnlyPending) {
      try {
        await deleteJawabanFileFromStorage(targetFile, selectedTugas.id, user.id)
      } catch (error) {
        console.warn('Gagal menghapus file jawaban sementara:', error)
      }

      setPendingJawabanFile(null)
      setJawabanFileKey(getFirstAttachmentValue(detail?.myJawaban?.file_urls, detail?.myJawaban?.file_url))
      setJawabanFileSize('')
      pushToast('success', 'File pengganti dibatalkan')
      return
    }

    try {
      setLoading(true)

      let storageError = null
      try {
        await deleteJawabanFileFromStorage(targetFile, selectedTugas.id, user.id)
      } catch (err) {
        storageError = err
        console.warn('Delete storage error (non-blocking):', err)
      }

      const existing = detail?.myJawaban || null
      const currentLink = (jawabanLink || existing?.link_url || '').trim()
      const existingPhotos = parseAssignmentFileList(existing?.file_urls).filter(isImageLikeFile)

      if (existing?.id) {
        if (currentLink || existingPhotos.length > 0) {
          const { error } = await supabase
            .from('tugas_jawaban')
            .update({
              file_url: existingPhotos[0] || null,
              file_urls: existingPhotos.length > 0 ? existingPhotos : null
            })
            .eq('id', existing.id)
            .eq('user_id', user.id)

          if (error) throw error

          setDetail((prev) => {
            if (!prev) return prev
            const nextJawaban = prev.myJawaban
              ? {
                  ...prev.myJawaban,
                  file_url: existingPhotos[0] || null,
                  file_urls: existingPhotos.length > 0 ? existingPhotos : null
                }
              : null
            const nextStatus = nextJawaban?.nilai != null ? 'dinilai' : nextJawaban ? 'menunggu' : 'belum'
            return { ...prev, myJawaban: nextJawaban, myStatus: nextStatus }
          })
        } else {
          const { error } = await supabase
            .from('tugas_jawaban')
            .delete()
            .eq('id', existing.id)
            .eq('user_id', user.id)

          if (error) throw error

          setDetail((prev) => (prev ? { ...prev, myJawaban: null, myStatus: 'belum' } : prev))
        }
      }

      setJawabanFileKey('')
      setJawabanFileSize('')
      if (!currentLink) setJawabanKomentar('')
      await loadTugasList()

      if (storageError) {
        const parsed = parseSupabaseError(storageError)
        pushToast('warning', `File di DB dihapus, tapi storage gagal: ${parsed.message}`)
      } else {
        pushToast('success', 'File jawaban dihapus')
      }
    } catch (error) {
      console.error('Delete jawaban file error:', error)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal menghapus file: ${parsed.message}`)
    } finally {
      setLoading(false)
    }
  }

  const saveJawaban = async () => {
    if (!user?.id || !selectedTugas || !detail?.tugas) return
    if (isUploading || loading) {
      pushToast('info', 'Tunggu proses upload atau submit sebelumnya selesai.')
      return
    }

    // ANTI-IDOR: pastikan tugas untuk kelas siswa
    const kelas = selectedKelas || kelasSiswa
    if (detail.tugas.kelas !== kelas) {
      pushToast('error', 'Akses ditolak: tugas bukan untuk kelas Anda')
      return
    }

    // validasi minimal: harus ada file atau link (pilih salah satu)
    const photoValues = jawabanPhotoValues.slice(0, MAX_ASSIGNMENT_PHOTOS)
    const attachmentValue = currentAttachmentValue
    const hasFile = Boolean(attachmentValue || photoValues.length > 0)
    const link = (jawabanLink || '').trim()
    const hasLink = Boolean(link)
    const komentar = (jawabanKomentar || '').trim()

    if (!hasFile && !hasLink) {
      pushToast('error', 'Upload file jawaban atau isi link jawaban')
      return
    }

    if (komentar.length > 500) {
      pushToast('error', 'Komentar maksimal 500 karakter')
      return
    }

    const lockReason = getSubmitLockReason(detail?.tugas, detail?.myJawaban, detail?.myStatus)
    if (lockReason) {
      pushToast('error', lockReason)
      return
    }

    // normalisasi link
    let safeLink = ''
    if (hasLink) {
      safeLink = link
      if (!/^https?:\/\//i.test(safeLink)) safeLink = `https://${safeLink}`
      try {
        // validasi URL
        // eslint-disable-next-line no-new
        new URL(safeLink)
      } catch {
        pushToast('error', 'Link tidak valid')
        return
      }
    }

    try {
      setLoading(true)

      const existing = detail.myJawaban
      const existingFiles = parseAssignmentFileList(existing?.file_urls, existing?.file_url)
      const nextFileValue = photoValues[0] || attachmentValue || null

      const payload = {
        tugas_id: selectedTugas.id,
        user_id: user.id,
        file_url: nextFileValue,
        file_urls: photoValues.length > 0 ? photoValues : null,
        link_url: safeLink || null,
        komentar_siswa: komentar || null,
        status: existing?.nilai != null ? 'dinilai' : 'menunggu',
        waktu_submit: new Date().toISOString(),
        ...academicPeriodPayload
      }

      const { error } = await supabase.assignments.submitAnswer(payload)
      if (error) throw error

      const nextFiles = photoValues.length > 0
        ? photoValues
        : payload.file_url
        ? [payload.file_url]
        : []
      const staleFiles = existingFiles.filter((value) => value && !nextFiles.includes(value))
      if (staleFiles.length > 0) {
        await Promise.allSettled(
          staleFiles.map((value) => deleteJawabanFileFromStorage(value, selectedTugas.id, user.id))
        )
      }

      setPendingJawabanFile(null)
      setPendingJawabanPhotos([])
      pushToast('success', 'Jawaban berhasil dikirim')
      showUploadSuccessNotice('Jawaban berhasil dikirim', 'Guru dapat melihat file, link, dan komentar Anda.')

      // refresh detail & list
      await loadTugasList()
      if (selectedTugas) await openDetail(selectedTugas)
    } catch (error) {
      console.error('Save jawaban error:', error)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal mengirim jawaban: ${parsed.message}`)
    } finally {
      setLoading(false)
    }
  }

  /* =========================
     Preview helpers
========================= */
  const openPreview = async (keyOrUrl) => {
    const raw = String(keyOrUrl || '').trim()
    if (!hasUsableValue(raw)) {
      pushToast('error', 'File atau link tidak tersedia')
      return
    }

    if (/^https?:\/\//i.test(raw)) {
      setPreviewFile(raw)
      return
    }

    if (looksLikeDomainUrl(raw)) {
      setPreviewFile(`https://${raw}`)
      return
    }

    try {
      const signed = await createSignedUrlForKey(raw, 60 * 60)
      if (!signed) throw new Error('Gagal membuat signed URL')
      setPreviewFile(signed)
    } catch (error) {
      console.error(error)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal membuka preview: ${parsed.message}`)
    }
  }

  const openPhotoGallery = async (values, initialIndex = 0, title = 'Preview Tugas Saya') => {
    const items = parseAssignmentFileList(values).filter(isImageLikeFile)
    if (items.length === 0) {
      pushToast('error', 'Foto belum tersedia')
      return
    }

    try {
      const resolved = await Promise.all(
        items.map(async (item) => {
          if (/^https?:\/\//i.test(item)) return item
          if (looksLikeDomainUrl(item)) return `https://${item}`
          return createSignedUrlForKey(item, 60 * 30)
        })
      )
      setPhotoGallery({
        items: resolved.filter(Boolean),
        initialIndex,
        title
      })
    } catch (error) {
      console.error(error)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal membuka galeri: ${parsed.message}`)
    }
  }

  /* =========================
     Realtime refresh
========================= */
  useEffect(() => {
    if (!user?.id) return
    const kelas = selectedKelas || kelasSiswa

    const channel = supabase
      .channel(`tugas_siswa_${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tugas' }, async (payload) => {
        const row = payload.new || payload.old
        if (row?.kelas && kelas && row.kelas !== kelas) return
        await Promise.all([loadTugasList(), loadMapelOptions()])

        if (selectedTugas && String(row?.id) === String(selectedTugas.id)) {
          await openDetail({ ...selectedTugas, ...row })
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tugas_jawaban' }, async (payload) => {
        // refresh hanya kalau yang berubah adalah jawaban user ini
        const uid = (payload.new && payload.new.user_id) || (payload.old && payload.old.user_id)
        if (uid !== user.id) return
        await loadTugasList()
        if (selectedTugas) {
          const tid =
            (payload.new && payload.new.tugas_id) || (payload.old && payload.old.tugas_id)
          if (tid === selectedTugas.id) {
            await openDetail(selectedTugas)
          }
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id, selectedTugas, selectedKelas, kelasSiswa, loadTugasList, loadMapelOptions])

  /* =========================
     Dashboard Stats
========================= */
  const visibleTugasList = useMemo(() => {
    const q = debouncedSearchTerm.trim().toLowerCase()
    if (!q) return tugasList
    return tugasList.filter((t) => (
      String(t.judul || '').toLowerCase().includes(q) ||
      String(t.mapel || '').toLowerCase().includes(q) ||
      String(t.keterangan || '').toLowerCase().includes(q)
    ))
  }, [tugasList, debouncedSearchTerm])

  const stats = useMemo(() => {
    const total = visibleTugasList.length
    const belum = visibleTugasList.filter((t) => t.myStatus === 'belum').length
    const menunggu = visibleTugasList.filter((t) => t.myStatus === 'menunggu').length
    const dinilai = visibleTugasList.filter((t) => t.myStatus === 'dinilai').length
    return { total, belum, menunggu, dinilai }
  }, [visibleTugasList])

  const submitLockReason = useMemo(() => {
    return getSubmitLockReason(detail?.tugas, detail?.myJawaban, detail?.myStatus)
  }, [detail?.tugas, detail?.myJawaban, detail?.myStatus])

  const isSubmissionLocked = Boolean(submitLockReason)

  const currentPhotoValues = useMemo(() => {
    const source = jawabanPhotoValues.length
      ? jawabanPhotoValues
      : parseAssignmentFileList(detail?.myJawaban?.file_urls, detail?.myJawaban?.file_url)
    return source.filter(isImageLikeFile).slice(0, MAX_ASSIGNMENT_PHOTOS)
  }, [jawabanPhotoValues, detail?.myJawaban?.file_urls, detail?.myJawaban?.file_url])

  const currentAttachmentValue = useMemo(() => {
    if (pendingJawabanPhotos.length > 0) return ''
    if (jawabanFileKey && !isImageLikeFile(jawabanFileKey)) return jawabanFileKey
    return getFirstAttachmentValue(detail?.myJawaban?.file_urls, detail?.myJawaban?.file_url)
  }, [
    pendingJawabanPhotos.length,
    jawabanFileKey,
    detail?.myJawaban?.file_urls,
    detail?.myJawaban?.file_url
  ])

  /* =========================
     Render
========================= */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50/30 p-4 sm:p-6">
      {uploadSuccessNotice && (
        <div className="fixed left-1/2 top-6 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2">
          <div
            key={uploadSuccessNotice.id}
            className="assignment-success-toast relative overflow-hidden rounded-2xl border border-emerald-200 bg-white px-4 py-3 shadow-2xl shadow-emerald-900/10"
            role="status"
            aria-live="polite"
          >
            <div className="absolute left-0 top-0 h-1 w-full bg-emerald-500" />
            <div className="flex items-center gap-3">
              <div className="assignment-success-toast__mark relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <span className="assignment-success-toast__pulse absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-30" />
                <CheckCircle2 className="assignment-success-toast__icon relative h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-extrabold text-emerald-900">{uploadSuccessNotice.title}</div>
                {uploadSuccessNotice.detail && (
                  <div className="mt-0.5 text-xs text-emerald-700">{uploadSuccessNotice.detail}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-full mx-auto space-y-6">
        {/* HEADER */}
        <div className="page-title-card">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                <span className="text-2xl text-white">🧑‍🎓</span>
              </div>
              <div>
                <h1 className="page-title-heading">Tugas Saya</h1>
                <p className="page-title-description">Lihat tugas kelas, kumpulkan jawaban, dan pantau nilai</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
                <div className="text-xs text-slate-500">Siswa</div>
                <div className="font-semibold text-slate-800">{profile?.nama || '-'}</div>
                <div className="text-xs text-slate-500 mt-1">Kelas: {kelasSiswa || '-'}</div>
              </div>
              <AcademicPeriodArchiveFilter
                activeAcademicPeriod={activeAcademicPeriod}
                periodFilter={periodFilter}
                academicYearOptions={academicYearOptions}
                semesterOptions={semesterOptions}
                setAcademicYear={setAcademicYear}
                setSemester={setSemester}
                resetToActivePeriod={resetToActivePeriod}
                title="Periode Tugas"
                className="min-w-[17rem]"
                compact
              />

              <button
                type="button"
                onClick={async () => {
                  pushToast('info', 'Memperbarui data...')
                  await Promise.all([loadMapelOptions(), loadTugasList()])
                  pushToast('success', 'Data diperbarui')
                }}
                disabled={isListLoading}
                className="px-4 py-3 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors font-semibold text-slate-700 shadow-sm disabled:opacity-60"
              >
                {isListLoading ? '⏳ Memuat...' : '🔄 Refresh'}
              </button>
            </div>
          </div>
        </div>

        {/* STATS */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MiniCard title="Total" value={stats.total} icon="📚" cls="bg-white border-slate-200" />
          <MiniCard title="Belum" value={stats.belum} icon="⏳" cls="bg-slate-50 border-slate-200" />
          <MiniCard title="Menunggu" value={stats.menunggu} icon="📝" cls="bg-yellow-50 border-yellow-200 text-yellow-800" />
          <MiniCard title="Dinilai" value={stats.dinilai} icon="✅" cls="bg-green-50 border-green-200 text-green-800" />
        </div>

        {/* FILTERS */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6">
          <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-500 rounded-xl flex items-center justify-center shadow">
              <span className="text-white text-sm">🎛️</span>
            </div>
            <span>Filter</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Kelas</label>
              <input
                className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-slate-50 text-sm"
                value={selectedKelas || kelasSiswa || ''}
                readOnly
              />
              <p className="text-[11px] text-slate-500 mt-1">Kelas otomatis dari profil.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Mapel</label>
              <select
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white text-sm"
                value={selectedMapel}
                onChange={(e) => setSelectedMapel(e.target.value)}
                disabled={isMapelLoading && mapelOptions.length === 0}
              >
                <option value="">Semua mapel</option>
                {isMapelLoading && mapelOptions.length === 0 && (
                  <option value="" disabled>Memuat mapel...</option>
                )}
                {mapelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Status</label>
              <select
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">Semua</option>
                <option value="belum">Belum</option>
                <option value="menunggu">Menunggu</option>
                <option value="dinilai">Dinilai</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Rentang Waktu</label>
              <select
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white text-sm"
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
              >
                <option value="recent">10 tugas terbaru</option>
                <option value="week">7 hari terakhir</option>
                <option value="all">Semua bulan periode</option>
                <option value="custom_months">Pilih bulan</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Cari</label>
              <input
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white text-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Cari judul / mapel..."
              />
            </div>
          </div>

          {timeRange === 'custom_months' && (
            <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-2xl">
              <div className="text-sm font-bold text-slate-800 mb-2">Pilih bulan (multi)</div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-56 overflow-auto pr-1">
                {monthOptions.map((m) => {
                  const checked = selectedMonths.includes(m.value)
                  return (
                    <label key={m.value} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const on = e.target.checked
                          setSelectedMonths((prev) => {
                            if (on) return Array.from(new Set([...prev, m.value]))
                            return prev.filter((x) => x !== m.value)
                          })
                        }}
                        className="w-4 h-4"
                      />
                      <span>{m.label}</span>
                    </label>
                  )
                })}
              </div>
              <div className="text-[11px] text-slate-500 mt-2">Tip: pilih 1–3 bulan biar ringkas.</div>
            </div>
          )}

          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedMapel('')
                setStatusFilter('all')
                setTimeRange('recent')
                setSelectedMonths([])
                setSearchTerm('')
                pushToast('info', 'Filter direset')
              }}
              className="px-4 py-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors font-semibold text-slate-700"
            >
              ♻️ Reset
            </button>
            <button
              type="button"
              onClick={loadTugasList}
              disabled={isListLoading}
              className="px-4 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-bold transition-all shadow-lg disabled:opacity-60"
            >
              {isListLoading ? '⏳ Memuat...' : '🔎 Terapkan'}
            </button>
          </div>
        </div>

        {/* LIST TUGAS */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <span>📜</span>
                <span>Daftar Tugas</span>
              </h3>
              <p className="text-sm text-slate-500 mt-1">Klik tugas untuk mengumpulkan jawaban.</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {!hasActiveTaskFilter && (
                <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">
                  10 tugas terbaru
                </span>
              )}
              {selectedMapel && (
                <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-700 text-xs font-semibold">
                  Mapel: {selectedMapel}
                </span>
              )}
              {statusFilter !== 'all' && (
                <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">
                  {statusFilter}
                </span>
              )}
              {timeRange === 'custom_months' && selectedMonths.length > 0 && (
                <span className="px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold">
                  {selectedMonths.length} bulan
                </span>
              )}
              {debouncedSearchTerm && (
                <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
                  Cari: {debouncedSearchTerm}
                </span>
              )}
            </div>
          </div>

          {isListLoading && visibleTugasList.length === 0 ? (
            <div className="text-center py-14 text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-purple-600" />
              <div className="font-bold text-slate-700">Memuat tugas</div>
              <div className="text-sm mt-1">Mengambil data tugas terbaru...</div>
            </div>
          ) : visibleTugasList.length === 0 ? (
            <div className="text-center py-14 text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
              <div className="text-6xl mb-4">🗂️</div>
              <div className="font-bold text-slate-700">Belum ada tugas</div>
              <div className="text-sm mt-1">Coba ubah filter atau tunggu guru membuat tugas.</div>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleTugasList.map((t) => {
                const expired = t.isExpired
                const beforeStart = t.isBeforeStart
                const nearDeadline = t.isNearDeadline
                const doneAndGraded = t.myStatus === 'dinilai'
                const answerFiles = parseAssignmentFileList(t.myJawaban?.file_urls, t.myJawaban?.file_url)
                const photoCount = answerFiles.filter(isImageLikeFile).length
                const hasAttachment = answerFiles.some((item) => !isImageLikeFile(item))
                const cardTone = doneAndGraded
                  ? 'border-green-200 bg-green-50/50'
                  : expired
                  ? 'border-red-200 bg-red-50/40'
                  : nearDeadline
                  ? 'border-yellow-200 bg-yellow-50/50'
                  : beforeStart
                  ? 'border-blue-200 bg-blue-50/40'
                  : 'border-slate-200 bg-white'

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => openDetail(t)}
                    className={`text-left p-5 rounded-2xl border transition-all hover:shadow-md ${cardTone}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-extrabold text-slate-800 truncate">{t.judul}</div>
                        <div className="text-xs text-slate-500 mt-1">{t.mapel}</div>
                      </div>
                      <StatusBadge status={t.myStatus} />
                    </div>

                    <div className="mt-3 text-xs text-slate-600">
                      Deadline:{' '}
                      <span className={`${expired ? 'text-red-700 font-semibold' : 'font-semibold'}`}>
                        {formatDateTime(t.deadline)}
                      </span>
                    </div>

                    <div className="mt-2 text-xs text-slate-600">
                      Mulai:{' '}
                      <span className={`${beforeStart ? 'text-blue-700 font-semibold' : 'font-semibold'}`}>
                        {formatDateTime(t.mulai)}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <ScoreBadge nilai={t.myJawaban?.nilai} />
                      {nearDeadline && !doneAndGraded && !expired && (
                        <span className="px-3 py-1 rounded-full border bg-yellow-100 text-yellow-800 border-yellow-200 text-xs font-bold">
                          ⚠️ Deadline dekat
                        </span>
                      )}
                      {beforeStart && (
                        <span className="px-3 py-1 rounded-full border bg-blue-100 text-blue-700 border-blue-200 text-xs font-bold">
                          ⏱️ Belum mulai
                        </span>
                      )}
                      {doneAndGraded && (
                        <span className="px-3 py-1 rounded-full border bg-green-100 text-green-700 border-green-200 text-xs font-bold">
                          ✅ Sudah dinilai
                        </span>
                      )}
                      {hasAttachment && (
                        <span className="px-3 py-1 rounded-full border bg-blue-50 text-blue-700 border-blue-200 text-xs font-bold">
                          📎 Ada file
                        </span>
                      )}
                      {photoCount > 0 && (
                        <span className="px-3 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-bold">
                          🖼️ {photoCount} foto
                        </span>
                      )}
                      {t.myJawaban?.link_url && (
                        <span className="px-3 py-1 rounded-full border bg-purple-50 text-purple-700 border-purple-200 text-xs font-bold">
                          🔗 Ada link
                        </span>
                      )}
                      {t.link && (
                        <span className="px-3 py-1 rounded-full border bg-indigo-50 text-indigo-700 border-indigo-200 text-xs font-bold">
                          🔗 Referensi guru
                        </span>
                      )}
                    </div>

                    {t.keterangan && (
                      <div className="mt-3 text-xs text-slate-500 line-clamp-2">
                        {t.keterangan}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* MODAL DETAIL */}
        {selectedTugas && (
          <div className="fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => { void closeDetail() }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Escape') void closeDetail()
              }}
            />

            <div className="absolute inset-0 flex items-end justify-center p-0 sm:items-center sm:p-6">
              <div className="flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:max-h-[94vh] sm:rounded-3xl">
                {/* Header */}
                <div className="p-5 sm:p-6 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-purple-50/40">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-purple-600 text-white flex items-center justify-center font-bold">
                          🧾
                        </div>
                        <div className="min-w-0">
                          <div className="text-xl sm:text-2xl font-extrabold text-slate-800 truncate">
                            {detail?.tugas?.judul || selectedTugas.judul}
                          </div>
                          <div className="text-sm text-slate-600 mt-1">
                            {detail?.tugas?.mapel || selectedTugas.mapel}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 font-semibold">
                          Dibuat: {formatDateTime(detail?.tugas?.created_at || selectedTugas.created_at)}
                        </span>
                        <span
                          className={`px-3 py-1 rounded-full font-semibold ${
                            detail?.tugas?.isBeforeStart ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          Mulai: {formatDateTime(detail?.tugas?.mulai || selectedTugas.mulai)}
                        </span>
                        <span
                          className={`px-3 py-1 rounded-full font-semibold ${
                            detail?.tugas?.isExpired || selectedTugas.isExpired
                              ? 'bg-red-100 text-red-700'
                              : detail?.tugas?.isNearDeadline || selectedTugas.isNearDeadline
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-green-100 text-green-700'
                          }`}
                        >
                          Deadline: {formatDateTime(detail?.tugas?.deadline || selectedTugas.deadline)}
                        </span>
                        <StatusBadge status={detail?.myStatus || selectedTugas.myStatus} />
                        <ScoreBadge nilai={detail?.myJawaban?.nilai ?? selectedTugas?.myJawaban?.nilai} />
                      </div>
                    </div>

                    <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
                      {detail?.tugas?.file_url && (
                        <button
                          type="button"
                          onClick={() => openPreview(detail.tugas.file_url)}
                          className="w-full rounded-2xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-700 sm:w-auto"
                        >
                          📎 Lampiran Guru
                        </button>
                      )}
                      {detail?.tugas?.link && (
                        <button
                          type="button"
                          onClick={() => openPreview(detail.tugas.link)}
                          className="w-full rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 sm:w-auto"
                        >
                          🔗 Link Guru
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => { void closeDetail() }}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 sm:w-auto"
                      >
                        ❌ Tutup
                      </button>
                    </div>
                  </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-auto p-4 sm:p-6">
                  {isLoadingDetail ? (
                    <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
                      <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                      <div className="text-slate-600 font-semibold">Memuat detail...</div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-5">
                      {/* Instruksi */}
                      <div className="space-y-4">
                        <div className="bg-white border border-slate-200 rounded-2xl p-4">
                          <div className="text-sm font-bold text-slate-800 mb-2">📌 Instruksi</div>
                          <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                            {detail?.tugas?.keterangan || 'Tidak ada instruksi.'}
                          </div>
                        </div>

                        {/* Jawaban saya */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-4">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                            <div>
                              <div className="text-sm font-bold text-slate-800">🧩 Jawaban Saya</div>
                              <div className="text-xs text-slate-500 mt-1">
                                Upload file, isi link, lalu klik <b>Kirim Jawaban</b>.
                              </div>
                            </div>

                            {isSubmissionLocked ? (
                              <span className="px-3 py-1 rounded-full bg-red-100 text-red-700 text-xs font-bold border border-red-200">
                                {submitLockReason}
                              </span>
                            ) : detail?.tugas?.isNearDeadline ? (
                              <span className="px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs font-bold border border-yellow-200">
                                Deadline mendekat
                              </span>
                            ) : (
                              <span className="px-3 py-1 rounded-full bg-green-100 text-green-700 text-xs font-bold border border-green-200">
                                Masih bisa submit
                              </span>
                            )}
                          </div>

                          {/* Link */}
                          <div className="mb-4">
                            <label className="block text-sm font-semibold text-slate-700 mb-2">Link jawaban (opsional)</label>
                            <input
                              className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white text-sm"
                              value={jawabanLink}
                              onChange={(e) => setJawabanLink(e.target.value)}
                              placeholder="contoh: drive.google.com/..."
                              disabled={isSubmissionLocked}
                            />
                            <div className="text-[11px] text-slate-500 mt-1">
                              Boleh tanpa http(s). Link manual disimpan di database/VPS, bukan di Google Drive sekolah.
                            </div>
                          </div>

                          <div className="mb-4">
                            <label className="block text-sm font-semibold text-slate-700 mb-2">Komentar untuk guru (opsional)</label>
                            <textarea
                              rows={3}
                              className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white text-sm resize-none"
                              value={jawabanKomentar}
                              onChange={(e) => setJawabanKomentar(e.target.value.slice(0, 500))}
                              placeholder="contoh: Jawaban utama ada di foto 1-3, perhitungan lanjutan di foto 4."
                              disabled={isSubmissionLocked}
                              maxLength={500}
                            />
                            <div className="mt-1 flex flex-col gap-1 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                              <span>Hanya guru yang mengajar tugas ini yang dapat melihat komentar.</span>
                              <span>{jawabanKomentar.length}/500</span>
                            </div>
                          </div>

                          <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                                  <Images className="h-4 w-4 text-purple-600" />
                                  Foto dari galeri perangkat
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  Maksimal {MAX_ASSIGNMENT_PHOTOS} foto, total sekitar {formatFileSize(ASSIGNMENT_PHOTOS_MAX_TOTAL_BYTES)}. Tiap foto otomatis dikompresi sampai {formatFileSize(ASSIGNMENT_PHOTO_MAX_BYTES)}.
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {currentPhotoValues.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => openPhotoGallery(currentPhotoValues, 0, 'Preview Tugas Saya')}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-bold text-purple-700 hover:bg-purple-100"
                                  >
                                    <Images className="h-4 w-4" />
                                    Preview ({currentPhotoValues.length})
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => galleryInputRef.current?.click()}
                                  disabled={isSubmissionLocked || isUploading}
                                  className="inline-flex items-center gap-2 rounded-2xl bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <ImagePlus className="h-4 w-4" />
                                  Pilih Foto
                                </button>
                              </div>
                            </div>
                            <input
                              ref={galleryInputRef}
                              type="file"
                              accept="image/*"
                              multiple
                              className="hidden"
                              onChange={(event) => {
                                void handleUploadJawabanPhotos(event.target.files)
                              }}
                            />

                            {currentPhotoValues.length > 0 && (
                              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                                {currentPhotoValues.map((value, idx) => (
                                  <button
                                    key={`${value}-${idx}`}
                                    type="button"
                                    onClick={() => openPhotoGallery(currentPhotoValues, idx, 'Preview Tugas Saya')}
                                    className="aspect-square rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 hover:border-purple-300 hover:bg-purple-50"
                                  >
                                    Foto {idx + 1}
                                    {jawabanPhotoSizes[idx] && (
                                      <span className="mt-1 block text-[10px] font-medium text-slate-400">
                                        {jawabanPhotoSizes[idx]}
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* File upload */}
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="font-bold text-slate-800">📎 File jawaban (opsional)</div>
                                <div className="mt-1 text-xs text-slate-500">
                                  Gunakan untuk PDF, dokumen, spreadsheet, presentasi, atau gambar tunggal.
                                </div>
                              </div>

                              {currentAttachmentValue && (
                                <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
                                  <button
                                    type="button"
                                    onClick={() => openPreview(currentAttachmentValue)}
                                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                                  >
                                    👁️ Preview
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleDeleteJawabanFile}
                                    className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={isSubmissionLocked}
                                  >
                                    🗑️ Hapus
                                  </button>
                                </div>
                              )}
                            </div>

                            {isUploading ? (
                              <UploadProgressTrain
                                label={uploadProgress || 'Mengupload file...'}
                                detail={uploadDetailForProvider(answerUploadProvider, 'Jawaban sedang diproses dan dikirim.')}
                                progress={uploadPercent}
                                tone={uploadToneForProvider(answerUploadProvider)}
                              />
                            ) : currentAttachmentValue ? (
                              <div className="grid gap-3 rounded-xl border border-green-200 bg-green-50 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] lg:items-stretch">
                                <div className="flex min-w-0 items-start gap-3">
                                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-xl text-green-700">✅</span>
                                  <div className="min-w-0">
                                    <div className="text-sm font-bold text-green-900">File siap dikirim</div>
                                    <div className="mt-1 text-xs leading-5 text-green-700">
                                      <span className="font-semibold">{jawabanFileSize || 'Ukuran akan tampil'}</span>
                                      <span className="mx-1">•</span>
                                      {isSubmissionLocked ? 'Jawaban sudah terkunci' : 'Masih bisa diganti sebelum dikirim atau dinilai'}
                                    </div>
                                  </div>
                                </div>

                                {!isSubmissionLocked && (
                                  <div className="min-w-0">
                                    <FileDropzone
                                      onFiles={handleUploadJawabanFile}
                                      accept={ASSIGNMENT_FILE_ACCEPT}
                                      label="Ganti file"
                                      disabled={isSubmissionLocked || isUploading}
                                      className="h-full p-4"
                                      small
                                    />
                                  </div>
                                )}
                              </div>
                            ) : (
                              <FileDropzone
                                onFiles={handleUploadJawabanFile}
                                accept={ASSIGNMENT_FILE_ACCEPT}
                                label="Seret file jawaban ke sini atau klik untuk memilih"
                                disabled={isSubmissionLocked || isUploading}
                              />
                            )}

                            <div className="mt-3 p-3 bg-white rounded-xl border border-slate-200">
                              <p className="text-xs font-semibold text-slate-700 mb-2">📋 Batas Ukuran File:</p>
                              <ul className="text-xs text-slate-600 space-y-1">
                                <li>🖼️ Gambar: maks {formatFileSize(ASSIGNMENT_PHOTO_MAX_BYTES)}/foto, total sekitar {formatFileSize(ASSIGNMENT_PHOTOS_MAX_TOTAL_BYTES)}</li>
                                <li>📄 PDF/Dokumen: maks 3MB per file</li>
                                <li>📊 PPT: maks 5MB per file</li>
                              </ul>
                            </div>
                          </div>

                          {/* Submit */}
                          <div className="mt-4 flex flex-col sm:flex-row gap-2">
                            <button
                              type="button"
                              onClick={saveJawaban}
                              disabled={isSubmissionLocked || isUploading || loading}
                              className="flex-1 px-4 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-bold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {loading ? 'Mengirim Jawaban...' : '🚀 Kirim Jawaban'}
                            </button>
                            {detail?.myJawaban?.link_url && (
                              <button
                                type="button"
                                onClick={() => openPreview(detail.myJawaban.link_url)}
                                className="px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 transition-colors text-center"
                              >
                                🔗 Preview Link Saya
                              </button>
                            )}
                          </div>

                          {detail?.myJawaban?.waktu_submit && (
                            <div className="mt-3 text-xs text-slate-500">
                              Terakhir submit: <b>{formatDateTime(detail.myJawaban.waktu_submit)}</b>
                            </div>
                          )}
                        </div>
                      </div>

                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Preview Modal */}
        {previewFile && <FilePreviewModal fileUrl={previewFile} onClose={() => setPreviewFile(null)} />}
        {photoGallery && (
          <PhotoGalleryModal
            items={photoGallery.items}
            initialIndex={photoGallery.initialIndex}
            title={photoGallery.title}
            onClose={() => setPhotoGallery(null)}
          />
        )}
      </div>
    </div>
  )
}
