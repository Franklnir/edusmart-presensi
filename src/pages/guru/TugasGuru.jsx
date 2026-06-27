// src/pages/guru/TugasGuru.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { CheckCircle2, Clock, Image as ImageIcon, Link2, MessageSquare, Paperclip, X } from 'lucide-react'
import {
  supabase,
  ASSIGNMENT_BUCKET,
  PROFILE_BUCKET,
  extractObjectPath,
  getSignedUrlForValue,
  removeStorageObject
} from '../../lib/supabase'
import { useLocalCache } from '../../hooks/useLocalCache'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import FileDropzone from '../../components/FileDropzone'
import FilePreviewModal from '../../components/FilePreviewModal'
import PhotoGalleryModal from '../../components/PhotoGalleryModal'
import UploadProgressTrain from '../../components/UploadProgressTrain'
import AcademicPeriodArchiveFilter from '../../components/AcademicPeriodArchiveFilter'
import useActiveAcademicPeriod from '../../hooks/useActiveAcademicPeriod'
import { parseSupabaseError } from '../../utils/supabaseError'
import { filterSchedulesForSemester } from '../../utils/schedulePeriodScope'
import {
  ASSIGNMENT_PHOTO_MAX_BYTES,
  ASSIGNMENT_PHOTOS_MAX_TOTAL_BYTES,
  MAX_ASSIGNMENT_PHOTOS,
  isImageLikeFile,
  parseAssignmentFileList
} from '../../utils/assignmentFiles'

/* =========================
   Constants & Helpers
========================= */
const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
]

const FILE_SIZE_LIMITS = {
  IMAGE: ASSIGNMENT_PHOTO_MAX_BYTES,
  PDF: 3 * 1024 * 1024,
  DOCUMENT: 3 * 1024 * 1024,
  SPREADSHEET: 3 * 1024 * 1024,
  PRESENTATION: 5 * 1024 * 1024
}

const KELAS_COLUMNS = 'id,nama,grade,suffix,tingkat,jurusan,angkatan'
const JADWAL_GURU_COLUMNS = 'id,kelas_id,mapel,guru_id,guru_nama,hari,jam_mulai,jam_selesai,tahun_ajaran,semester,periode_berlaku'
const TUGAS_GURU_COLUMNS = 'id,kelas,judul,mapel,mulai,deadline,keterangan,file_url,link,created_by,created_at,updated_at,tahun_ajaran,semester,angkatan'
const TUGAS_JAWABAN_STATS_COLUMNS = 'tugas_id,user_id,nilai,status'
const TUGAS_JAWABAN_DETAIL_COLUMNS = 'id,tugas_id,user_id,file_url,file_urls,link_url,komentar_siswa,nilai,status,waktu_submit,profiles(nama,photo_url)'
const DEFAULT_TASK_LIST_LIMIT = 10

const isHttpUrl = (v = '') => /^https?:\/\//i.test(String(v || ''))
const looksLikeDomainUrl = (v = '') => /^[a-z0-9-]+(\.[a-z0-9-]+)+(?::\d+)?(\/|$)/i.test(String(v || '').trim())

const normalizeOptionalUrl = (value = '') => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = isHttpUrl(raw) ? raw : looksLikeDomainUrl(raw) ? `https://${raw}` : ''
  if (!normalized) return ''
  try {
    return new URL(normalized).toString()
  } catch {
    return ''
  }
}

const hasUsableValue = (value = '') => {
  const raw = String(value || '').trim()
  if (!raw) return false
  const normalized = raw.toLowerCase()
  return !['null', 'undefined', '-', 'n/a'].includes(normalized)
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

const addCacheBuster = (url) => {
  if (!url) return ''
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}t=${Date.now()}`
}

const getNowDateTimeLocal = () => {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 16)
}

const maxDateTimeLocal = (a, b) => (a > b ? a : b)

const toStartDateTimeLocal = (dateString) => (dateString ? `${dateString}T00:00` : '')
const toEndDateTimeLocal = (dateString) => (dateString ? `${dateString}T23:59` : '')

const clampDateTimeLocal = (value, min, max) => {
  let next = value || min || getNowDateTimeLocal()
  if (min && next < min) next = min
  if (max && next > max) next = max
  return next
}

const NEAR_DEADLINE_HOURS = 24

const toDatetimeLocalValue = (isoString) => {
  if (!isoString) return getNowDateTimeLocal()
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return getNowDateTimeLocal()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime())

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

const getTaskWindowInfo = (mulai, deadline, stats = {}, nowRef = new Date()) => {
  const mulaiDate = mulai ? new Date(mulai) : null
  const deadlineDate = deadline ? new Date(deadline) : null

  const isBeforeStart = mulaiDate ? isValidDate(mulaiDate) && nowRef < mulaiDate : false
  const isExpired = deadlineDate ? isValidDate(deadlineDate) && nowRef > deadlineDate : false
  const isNearDeadline =
    deadlineDate && isValidDate(deadlineDate) && !isExpired
      ? deadlineDate.getTime() - nowRef.getTime() <= NEAR_DEADLINE_HOURS * 60 * 60 * 1000
      : false

  const totalSiswa = Number(stats?.total_siswa || 0)
  const submitted = Number(stats?.total_dikumpulkan || 0)
  const graded = Number(stats?.sudah || 0)
  const allSubmittedAndGraded = totalSiswa > 0 && submitted >= totalSiswa && graded >= totalSiswa

  return {
    isBeforeStart,
    isExpired,
    isNearDeadline,
    allSubmittedAndGraded
  }
}

const isPastDateTimeLocal = (value) => {
  if (!value) return false
  const date = new Date(value)
  if (!isValidDate(date)) return false
  const now = new Date()
  now.setSeconds(0, 0)
  return date < now
}

const validateTimelineInput = (mulai, deadline, options = {}) => {
  const {
    allowPastStart = false,
    allowPastDeadline = false,
    periodStart = '',
    periodEnd = '',
    periodLabel = ''
  } = options
  const now = new Date()
  now.setSeconds(0, 0)
  const mulaiDate = mulai ? new Date(mulai) : null
  const deadlineDate = deadline ? new Date(deadline) : null
  const periodStartDate = periodStart ? new Date(periodStart) : null
  const periodEndDate = periodEnd ? new Date(periodEnd) : null

  if (!mulai || !isValidDate(mulaiDate)) return 'Waktu mulai wajib diisi dan valid'
  if (!deadline || !isValidDate(deadlineDate)) return 'Deadline wajib diisi dan valid'
  if (!allowPastStart && mulaiDate < now) return 'Waktu mulai tidak boleh di masa lalu'
  if (!allowPastDeadline && deadlineDate < now) return 'Deadline tidak boleh di masa lalu'
  if (deadlineDate <= mulaiDate) return 'Deadline harus setelah waktu mulai'
  if (isValidDate(periodStartDate) && mulaiDate < periodStartDate) {
    return `Waktu mulai harus berada dalam periode ${periodLabel || 'aktif'}`
  }
  if (isValidDate(periodEndDate) && deadlineDate > periodEndDate) {
    return `Deadline tidak boleh melewati periode ${periodLabel || 'aktif'}`
  }
  return ''
}

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
  return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${sizes[i]}`
}

const formatKelasDisplay = (slug) => {
  if (!slug) return ''
  try {
    return slug
      .split('-')
      .map((part) => part.toUpperCase())
      .join(' ')
  } catch {
    return slug
  }
}

const normalizeKelasKey = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, '-')

const buildKelasVariants = (value = '') => {
  const raw = String(value || '').trim()
  if (!raw) return []
  const dashToSpace = raw.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  const spaceToDash = raw.replace(/\s+/g, '-').replace(/-+/g, '-').trim()

  return Array.from(
    new Set([
      raw,
      raw.toLowerCase(),
      raw.toUpperCase(),
      dashToSpace,
      dashToSpace.toLowerCase(),
      dashToSpace.toUpperCase(),
      spaceToDash,
      spaceToDash.toLowerCase(),
      spaceToDash.toUpperCase()
    ].filter(Boolean))
  )
}

const initials = (name = '?') => {
  const parts = (name || '').trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?'
}

const sanitizeFileName = (name = 'file') => {
  const base = String(name || 'file')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 80)
  return base || 'file'
}

// ANTI-IDOR: validasi guru hanya boleh akses kelas yang dia ampu
const validateKelasAccess = (userKelasList, kelasId) => {
  if (!kelasId || !Array.isArray(userKelasList) || userKelasList.length === 0) return false
  return userKelasList.some((k) => k.id === kelasId)
}

/* =========================
   Compression Helpers
========================= */
const compressImage = async (file, maxSizeKB = 100, initialQuality = 0.9) => {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) return reject(new Error('File bukan gambar'))
    if (file.size <= maxSizeKB * 1024) return resolve(file)

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas tidak didukung'))

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
              if (!blob) return reject(new Error('Gagal mengkompresi gambar'))

              const currentKB = blob.size / 1024
              if (currentKB > maxSizeKB && quality > 0.3) {
                quality -= 0.1
                width = Math.floor(width * 0.85)
                height = Math.floor(height * 0.85)

                if (width < 100 || height < 100) {
                  return resolve(new File([blob], file.name, { type: file.type, lastModified: Date.now() }))
                }
                return step()
              }

              return resolve(new File([blob], file.name, { type: file.type, lastModified: Date.now() }))
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

const compressFileBeforeUpload = async (file) => {
  const fileType = file?.type || ''
  const fileName = (file?.name || '').toLowerCase()

  const ensureMax = (maxBytes, label) => {
    if (file.size <= maxBytes) return file
    const maxMB = Math.round((maxBytes / (1024 * 1024)) * 100) / 100
    throw new Error(`File ${label} terlalu besar (${formatFileSize(file.size)}). Maksimal ${maxMB}MB.`)
  }

  if (fileType.startsWith('image/')) {
    return await compressImage(file, FILE_SIZE_LIMITS.IMAGE / 1024)
  }
  if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) return ensureMax(FILE_SIZE_LIMITS.PDF, 'PDF')
  if (fileType.includes('spreadsheet') || fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
    return ensureMax(FILE_SIZE_LIMITS.SPREADSHEET, 'spreadsheet')
  }
  if (fileType.includes('presentation') || fileName.endsWith('.ppt') || fileName.endsWith('.pptx')) {
    return ensureMax(FILE_SIZE_LIMITS.PRESENTATION, 'presentasi')
  }
  if (
    fileType.includes('document') ||
    fileName.endsWith('.doc') ||
    fileName.endsWith('.docx') ||
    fileName.endsWith('.odt') ||
    fileName.endsWith('.rtf')
  ) {
    return ensureMax(FILE_SIZE_LIMITS.DOCUMENT, 'dokumen')
  }

  throw new Error(
    'Tipe file tidak didukung. Gunakan gambar (JPG/PNG), PDF/Dokumen, Spreadsheet, atau PPT.'
  )
}

/* =========================
   Storage Helpers (FIXED)
   - Preview selalu buat signed URL baru
   - Support input path maupun URL (public/signed lama)
========================= */
const normalizeAssignmentKey = (urlOrPath) => extractObjectPath(ASSIGNMENT_BUCKET, urlOrPath || '')
const isGoogleDriveUrl = (value = '') => /^https?:\/\/(?:drive|docs)\.google\.com\//i.test(String(value || '').trim())

const createSignedUrlForAssignment = async (urlOrPath, expiresInSec = 60 * 15) => {
  const key = normalizeAssignmentKey(urlOrPath)
  if (!key) {
    const normalizedExternal = normalizeOptionalUrl(urlOrPath)
    if (normalizedExternal) return normalizedExternal
    throw new Error('Path file tidak valid')
  }
  // getSignedUrlForValue sudah handle url/path dan akan membuat signed url baru
  return getSignedUrlForValue(ASSIGNMENT_BUCKET, key, expiresInSec)
}

// ANTI-IDOR: penghapusan file hanya untuk folder milik guru (tugas_lampiran/<guruId>/...)
const deleteTeacherAttachment = async (urlOrPath, teacherId) => {
  const raw = String(urlOrPath || '').trim()
  if (isGoogleDriveUrl(raw)) {
    const { error } = await supabase.storage.from(ASSIGNMENT_BUCKET).remove([raw])
    if (error) throw error
    return
  }

  const key = normalizeAssignmentKey(urlOrPath)
  if (!key) return
  if (!String(key).startsWith(`tugas_lampiran/${teacherId}/`)) {
    throw new Error('Akses tidak diizinkan untuk menghapus file ini')
  }
  const res = await removeStorageObject(ASSIGNMENT_BUCKET, key)
  if (!res.ok) throw res.error
}

/* =========================
   Small UI Bits
========================= */
function Avatar({ src, name }) {
  const [broken, setBroken] = useState(false)
  const [resolvedSrc, setResolvedSrc] = useState('')

  useEffect(() => {
    let cancelled = false
    setBroken(false)

    const resolve = async () => {
      if (!src) {
        if (!cancelled) setResolvedSrc('')
        return
      }

      try {
        const signed = await getSignedUrlForValue(PROFILE_BUCKET, src, 60 * 60)
        if (!cancelled) setResolvedSrc(addCacheBuster(signed))
      } catch (err) {
        if (!cancelled) setResolvedSrc(isHttpUrl(src) ? addCacheBuster(src) : '')
      }
    }

    resolve()
    return () => {
      cancelled = true
    }
  }, [src])

  if (!resolvedSrc || broken) {
    return (
      <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white font-semibold text-sm">
        {initials(name)}
      </div>
    )
  }

  return (
    <img
      src={resolvedSrc}
      alt={name}
      className="w-10 h-10 rounded-full object-cover border-2 border-slate-200"
      onError={() => setBroken(true)}
    />
  )
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

/* =========================
   Main Component
========================= */
export default function TugasGuru() {
  const { user, profile } = useAuthStore()
  const { loading, pushToast, setLoading } = useUIStore()
  const {
	    activeAcademicPeriod,
	    period,
	    dateFilterPeriod,
	    periodFilter,
    academicYearOptions,
    semesterOptions,
    setAcademicYear,
    setSemester,
    resetToActivePeriod,
    applyPeriodFilters,
    activeAcademicPeriodPayload,
    isViewingArchivePeriod
  } = useActiveAcademicPeriod({
    storageKey: 'edusmart.guru.tugas.periodFilter'
  })

  /* ---------- State ---------- */
  const [jadwalAll, setJadwalAll] = useLocalCache('guru_tugas_jadwalAll', [])
  const [kelasList, setKelasList] = useLocalCache('guru_tugas_kelasList', [])

  // Create form
  const [isCreatePanelOpen, setIsCreatePanelOpen] = useState(false)
  const [kelas, setKelas] = useState('')
  const [mapelList, setMapelList] = useState([])
  const [selectedMapel, setSelectedMapel] = useState('')
  const [form, setForm] = useState({
    judul: '',
    keterangan: '',
    link: '',
    mulai: getNowDateTimeLocal(),
    deadline: getNowDateTimeLocal(),
    file_url: ''
  })
  const [isUploadingFile, setIsUploadingFile] = useState(false)
  const [uploadedFileSizeCreate, setUploadedFileSizeCreate] = useState('')
  const [pendingCreateFile, setPendingCreateFile] = useState(null)
  const [compressionProgress, setCompressionProgress] = useState(null)
  const [uploadProvider, setUploadProvider] = useState(null)
  const [uploadPercent, setUploadPercent] = useState(null)

  // History filter
  const [selectedKelasFilter, setSelectedKelasFilter] = useState('')
  const [mapelListFilter, setMapelListFilter] = useState([])
  const [selectedSubject, setSelectedSubject] = useState('')
  const [timeRange, setTimeRange] = useState('recent') // recent | week | all | custom_months
  const [filterStatus, setFilterStatus] = useState('all') // all | active | expired
  const [selectedMonths, setSelectedMonths] = useState([])
  const [historySearchTerm, setHistorySearchTerm] = useState('')
  const [debouncedHistorySearchTerm, setDebouncedHistorySearchTerm] = useState('')

  useEffect(() => {
    if (isViewingArchivePeriod && ['recent', 'week'].includes(timeRange)) {
      setTimeRange('all')
    }
  }, [isViewingArchivePeriod, timeRange])

  const createPeriodBounds = useMemo(() => {
    const startDate =
      activeAcademicPeriod.academicYearStartsAt ||
      period.academicYearStartsAt ||
      dateFilterPeriod.startsAt
    const endDate =
      activeAcademicPeriod.academicYearEndsAt ||
      period.academicYearEndsAt ||
      dateFilterPeriod.endsAt
    const startsAt = toStartDateTimeLocal(startDate)
    const endsAt = toEndDateTimeLocal(endDate)
    const nowLocal = getNowDateTimeLocal()
    const min = startsAt ? maxDateTimeLocal(nowLocal, startsAt) : nowLocal

    return {
      startsAt,
      endsAt,
      min,
      label: `${activeAcademicPeriod.tahunAjaran || period.tahunAjaran || 'periode aktif'}`
    }
  }, [
    activeAcademicPeriod.academicYearEndsAt,
    activeAcademicPeriod.academicYearStartsAt,
    activeAcademicPeriod.tahunAjaran,
    dateFilterPeriod.endsAt,
    dateFilterPeriod.startsAt,
    period.academicYearEndsAt,
    period.academicYearStartsAt,
    period.tahunAjaran
  ])

  useEffect(() => {
    if (!isCreatePanelOpen) return
    setForm((prev) => {
      const mulai = clampDateTimeLocal(prev.mulai, createPeriodBounds.min, createPeriodBounds.endsAt)
      const deadline = clampDateTimeLocal(prev.deadline, mulai, createPeriodBounds.endsAt)
      if (mulai === prev.mulai && deadline === prev.deadline) return prev
      return { ...prev, mulai, deadline }
    })
  }, [createPeriodBounds.endsAt, createPeriodBounds.min, isCreatePanelOpen])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedHistorySearchTerm(historySearchTerm.trim())
    }, 350)
    return () => window.clearTimeout(timer)
  }, [historySearchTerm])

  const hasActiveHistoryFilter = useMemo(() => (
    Boolean(
      selectedKelasFilter ||
      selectedSubject ||
      filterStatus !== 'all' ||
      debouncedHistorySearchTerm.trim() ||
      timeRange !== 'recent' ||
      isViewingArchivePeriod
    )
  ), [
    selectedKelasFilter,
    selectedSubject,
    filterStatus,
    debouncedHistorySearchTerm,
    timeRange,
    isViewingArchivePeriod
  ])

  // Detail
  const [selectedTugas, setSelectedTugas] = useState(null)
  const [listTugas, setListTugas, hasListTugas] = useLocalCache('guru_tugas_list', [])
  const [isLoadingList, setIsLoadingList] = useState(!hasListTugas)
  const [siswaDiKelas, setSiswaDiKelas] = useState([])
  const [jawabanTugas, setJawabanTugas] = useState([])
  const [nilaiInput, setNilaiInput] = useState({})
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)

  // Edit
  const [isEditingTugas, setIsEditingTugas] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [uploadedFileSizeEdit, setUploadedFileSizeEdit] = useState('')
  const [editExistingFileSize, setEditExistingFileSize] = useState('')
  const [editOriginalFile, setEditOriginalFile] = useState('')
  const [pendingEditFile, setPendingEditFile] = useState(null)

  // Sidebar: tasks needing grading
  const [tugasPerluDinilai, setTugasPerluDinilai] = useState([])
  const [isLoadingTugasPerluDinilai, setIsLoadingTugasPerluDinilai] = useState(false)

  // Preview
  const [previewFile, setPreviewFile] = useState(null)
  const [photoGallery, setPhotoGallery] = useState(null)
  const [studentCommentPreview, setStudentCommentPreview] = useState(null)
  const detailLoadIdRef = useRef(0)
  const uploadAbortRef = useRef(null)
  const pendingCreateFileRef = useRef(null)
  const userIdRef = useRef('')

  /* ---------- Derived: kelas yang guru ampu ---------- */
  const myKelasList = useMemo(() => {
    if (!jadwalAll.length || !kelasList.length) return []

    const kelasSet = new Set()
    jadwalAll.forEach((j) => j.kelas_id && kelasSet.add(j.kelas_id))

    return [...kelasSet]
      .map((kelasId) => {
        const kelasData = kelasList.find((k) => k.id === kelasId)
        return {
          id: kelasId,
          nama: kelasData?.nama || formatKelasDisplay(kelasId),
          slug: kelasId
        }
      })
      .sort((a, b) => a.nama.localeCompare(b.nama))
  }, [jadwalAll, kelasList])

  const selectedHistoryKelasName = useMemo(() => {
    if (!selectedKelasFilter) return ''
    return myKelasList.find((k) => k.id === selectedKelasFilter)?.nama || formatKelasDisplay(selectedKelasFilter)
  }, [myKelasList, selectedKelasFilter])

  /* ---------- Access Control ---------- */
  const validateTugasAccess = useCallback(
    (tugas) => Boolean(tugas && user?.id && tugas.created_by === user.id),
    [user?.id]
  )

  /* ========== Body scroll lock on modal ========== */
  useEffect(() => {
    document.body.style.overflow = selectedTugas ? 'hidden' : 'unset'
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [selectedTugas])

  useEffect(() => {
    pendingCreateFileRef.current = pendingCreateFile
  }, [pendingCreateFile])

  useEffect(() => {
    userIdRef.current = user?.id || ''
  }, [user?.id])

  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort()
      const pendingValue = pendingCreateFileRef.current?.value
      const teacherId = userIdRef.current
      if (pendingValue && teacherId) {
        void deleteTeacherAttachment(pendingValue, teacherId).catch((error) => {
          console.warn('Gagal membersihkan lampiran tugas sementara:', error)
        })
      }
    }
  }, [])

  /* ========== Reset months when timeRange changes ========== */
  useEffect(() => {
    if (timeRange !== 'custom_months') setSelectedMonths([])
  }, [timeRange])

  /* =========================
     1) Load master kelas + jadwal guru dalam satu request batch
========================= */
  useEffect(() => {
    const loadInitialData = async () => {
      if (!user?.id) return
      try {
        let jadwalQuery = supabase.from('jadwal').select(JADWAL_GURU_COLUMNS).eq('guru_id', user.id)
        jadwalQuery = applyPeriodFilters(jadwalQuery)

        const { data, error } = await supabase.batch([
          {
            key: 'kelas',
            query: supabase.from('kelas').select(KELAS_COLUMNS).order('grade').order('suffix')
          },
          {
            key: 'jadwal',
            query: jadwalQuery
          }
        ])
        if (error && !data) throw error

        const kelasRes = data?.kelas || {}
        const jadwalRes = data?.jadwal || {}
        if (kelasRes.error) throw kelasRes.error
        if (jadwalRes.error) throw jadwalRes.error

        setKelasList(kelasRes.data || [])
        setJadwalAll(filterSchedulesForSemester(jadwalRes.data || [], periodFilter.semester))
      } catch (error) {
        console.error('Error loading data awal tugas:', error)
        pushToast('error', 'Gagal memuat data awal tugas')
      }
    }
    loadInitialData()
  }, [applyPeriodFilters, periodFilter.semester, user?.id, pushToast])

  /* =========================
     2) Mapel list untuk form create
========================= */
  useEffect(() => {
    if (kelas && jadwalAll.length) {
      const mapels = jadwalAll
        .filter((j) => j.kelas_id === kelas)
        .map((j) => j.mapel)
        .filter((v, i, self) => self.indexOf(v) === i)
        .sort()

      setMapelList(mapels)
      if (mapels.length > 0 && !mapels.includes(selectedMapel)) setSelectedMapel(mapels[0])
      if (mapels.length === 0) setSelectedMapel('')
    } else {
      setMapelList([])
      setSelectedMapel('')
    }
  }, [kelas, jadwalAll, selectedMapel])

  /* =========================
     3) Mapel list untuk filter history
========================= */
  useEffect(() => {
    if (selectedKelasFilter && jadwalAll.length) {
      const mapels = jadwalAll
        .filter((j) => j.kelas_id === selectedKelasFilter)
        .map((j) => j.mapel)
        .filter((v, i, self) => self.indexOf(v) === i)
        .sort()

      setMapelListFilter(mapels)
      if (selectedSubject && !mapels.includes(selectedSubject)) setSelectedSubject('')
      if (mapels.length === 0) setSelectedSubject('')
    } else {
      setMapelListFilter([])
      setSelectedSubject('')
    }
  }, [selectedKelasFilter, jadwalAll, selectedSubject])

  /* =========================
     4) Load list tugas (history) + stats
========================= */
  const loadTugas = useCallback(async () => {
    if (!user?.id) return
    try {
      setLoading(true)
      const now = new Date()
      const normalizedSearch = debouncedHistorySearchTerm.trim().toLowerCase()

      let query = supabase.from('tugas').select(TUGAS_GURU_COLUMNS).eq('created_by', user.id)
      query = applyPeriodFilters(query)

      if (selectedKelasFilter) query = query.eq('kelas', selectedKelasFilter)
      if (selectedSubject) query = query.eq('mapel', selectedSubject)

      if (filterStatus === 'active') query = query.gte('deadline', now.toISOString())
      if (filterStatus === 'expired') query = query.lt('deadline', now.toISOString())

      if (timeRange === 'week') {
        const weekAgo = new Date(now)
        weekAgo.setDate(now.getDate() - 7)
        query = query.gte('created_at', weekAgo.toISOString())
      } else if (timeRange === 'all') {
	        if (dateFilterPeriod.startsAt && dateFilterPeriod.endsAt) {
	          const start = new Date(`${dateFilterPeriod.startsAt}T00:00:00`)
	          const end = new Date(`${dateFilterPeriod.endsAt}T00:00:00`)
	          end.setDate(end.getDate() + 1)
	          query = query.gte('created_at', start.toISOString()).lt('created_at', end.toISOString())
	        }
      } else if (timeRange === 'custom_months' && selectedMonths.length > 0) {
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

      query = query.order('created_at', { ascending: false })
      if (!hasActiveHistoryFilter) query = query.limit(DEFAULT_TASK_LIST_LIMIT)
      const { data: tugasRaw, error } = await query
      if (error) throw error

      let tugasData = sortTasksByNewest(tugasRaw || [])

      if (normalizedSearch) {
        tugasData = tugasData.filter((t) => (
          String(t.judul || '').toLowerCase().includes(normalizedSearch) ||
          String(t.mapel || '').toLowerCase().includes(normalizedSearch) ||
          String(t.keterangan || '').toLowerCase().includes(normalizedSearch) ||
          String(formatKelasDisplay(t.kelas) || '').toLowerCase().includes(normalizedSearch)
        ))
      }

      if (timeRange === 'custom_months') {
        if (selectedMonths.length > 0) {
          const setMonths = new Set(selectedMonths)
          tugasData = tugasData.filter((t) => {
            if (!t.created_at) return false
            const d = new Date(t.created_at)
            if (!isValidDate(d)) return false
            const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
            return setMonths.has(ym)
          })
        }
      }

      if (!hasActiveHistoryFilter) {
        tugasData = tugasData.slice(0, DEFAULT_TASK_LIST_LIMIT)
      }

      if (tugasData.length === 0) {
        setListTugas([])
        return
      }

      const tugasIds = tugasData.map((t) => t.id)
      const uniqueKelas = [...new Set(tugasData.map((t) => t.kelas).filter(Boolean))]
      const uniqueKelasVariants = Array.from(new Set(uniqueKelas.flatMap((k) => buildKelasVariants(k))))

      const statRequests = []
      if (tugasIds.length > 0) {
        statRequests.push({
          key: 'jawaban',
          query: supabase.from('tugas_jawaban').select(TUGAS_JAWABAN_STATS_COLUMNS).in('tugas_id', tugasIds)
        })
      }
      if (uniqueKelasVariants.length > 0) {
        if (isViewingArchivePeriod && period.tahunAjaran) {
          statRequests.push({
            key: 'classHistory',
            query: supabase
              .from('student_class_histories')
              .select('student_id, class_id')
              .in('class_id', uniqueKelasVariants)
              .eq('tahun_ajaran', period.tahunAjaran)
              .in('status', ['active', 'nonaktif', 'mutasi'])
          })
        } else {
          statRequests.push({
            key: 'siswa',
            query: supabase
              .from('profiles')
              .select('id, kelas')
              .eq('role', 'siswa')
              .in('kelas', uniqueKelasVariants)
          })
        }
      }

      const { data: statBatch } = await supabase.batch(statRequests)

      const jawabanRes = statBatch?.jawaban || { data: [], error: null }
      const siswaRes = statBatch?.siswa || { data: [], error: null }
      const classHistoryRes = statBatch?.classHistory || { data: [], error: null }
      if (jawabanRes.error) console.error('Error fetching stats jawaban tugas:', jawabanRes.error)
      if (siswaRes.error) console.error('Error fetching students for stats:', siswaRes.error)
      if (classHistoryRes.error) console.error('Error fetching class history for stats:', classHistoryRes.error)

      const jawabanArr = jawabanRes.data || []
      let siswaArr = siswaRes.data || []
      const classHistoryArr = classHistoryRes.data || []
      if (isViewingArchivePeriod && uniqueKelasVariants.length > 0 && classHistoryArr.length === 0) {
        const { data: fallbackSiswa, error: fallbackSiswaError } = await supabase
          .from('profiles')
          .select('id, kelas')
          .eq('role', 'siswa')
          .in('kelas', uniqueKelasVariants)
        if (fallbackSiswaError) console.error('Error fetching fallback students for stats:', fallbackSiswaError)
        else siswaArr = fallbackSiswa || []
      }
      const studentCountByClassKey = new Map()
      if (classHistoryArr.length) {
        const idsByClass = new Map()
        classHistoryArr.forEach((row) => {
          const classKey = normalizeKelasKey(row.class_id)
          const studentId = String(row.student_id || '').trim()
          if (!classKey || !studentId) return
          if (!idsByClass.has(classKey)) idsByClass.set(classKey, new Set())
          idsByClass.get(classKey).add(studentId)
        })
        idsByClass.forEach((ids, classKey) => {
          studentCountByClassKey.set(classKey, ids.size)
        })
      }

      const formatted = tugasData.map((tugas) => {
        const kelasKey = normalizeKelasKey(tugas.kelas)
        const siswaKelas = siswaArr.filter((s) => normalizeKelasKey(s.kelas) === kelasKey)
        const totalSiswa = studentCountByClassKey.has(kelasKey)
          ? studentCountByClassKey.get(kelasKey)
          : siswaKelas.length

        const jawabanIni = jawabanArr.filter((j) => j.tugas_id === tugas.id)
        const uniqueByUser = Object.values(
          jawabanIni.reduce((acc, j) => {
            acc[j.user_id] = j
            return acc
          }, {})
        )

        const sudahDinilai = uniqueByUser.filter((j) => j.nilai != null).length
        const belumDinilai = uniqueByUser.filter((j) => j.nilai == null).length
        const totalDikumpulkan = uniqueByUser.length
        const belumMengerjakan = Math.max(0, totalSiswa - totalDikumpulkan)

        const windowInfo = getTaskWindowInfo(tugas.mulai, tugas.deadline, {
          total_siswa: totalSiswa,
          total_dikumpulkan: totalDikumpulkan,
          sudah: sudahDinilai
        })

        return {
          ...tugas,
          kelasDisplay: formatKelasDisplay(tugas.kelas),
          isExpired: windowInfo.isExpired,
          isBeforeStart: windowInfo.isBeforeStart,
          isNearDeadline: windowInfo.isNearDeadline,
          allSubmittedAndGraded: windowInfo.allSubmittedAndGraded,
          hasGradedSubmissions: sudahDinilai > 0,
          stats: {
            sudah: sudahDinilai,
            belum_dinilai: belumDinilai,
            belum_mengerjakan: belumMengerjakan,
            total_siswa: totalSiswa,
            total_dikumpulkan: totalDikumpulkan
          }
        }
      })

      setListTugas(sortTasksByNewest(formatted))
    } catch (error) {
      console.error('Error loading tugas:', error)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal memuat data tugas: ${parsed.message}`)
    } finally {
      setLoading(false)
    }
  }, [
    applyPeriodFilters,
    user?.id,
    selectedKelasFilter,
    selectedSubject,
    timeRange,
    filterStatus,
    selectedMonths,
    debouncedHistorySearchTerm,
    hasActiveHistoryFilter,
    isViewingArchivePeriod,
    period.tahunAjaran,
	    dateFilterPeriod.endsAt,
	    dateFilterPeriod.startsAt,
    setLoading,
    pushToast
  ])

  useEffect(() => {
    if (user?.id) loadTugas()
  }, [user?.id, loadTugas])

  /* =========================
     5) Load "tugas perlu dinilai" (sidebar)
========================= */
  const loadTugasPerluDinilai = useCallback(async () => {
    if (!user?.id) return
    try {
      setIsLoadingTugasPerluDinilai(true)

      let tugasQuery = supabase
        .from('tugas')
        .select(TUGAS_GURU_COLUMNS)
        .eq('created_by', user.id)
      tugasQuery = applyPeriodFilters(tugasQuery)
      const { data: tugasData, error: tugasError } = await tugasQuery

      if (tugasError) throw tugasError
      if (!tugasData || tugasData.length === 0) {
        setTugasPerluDinilai([])
        return
      }

      const tugasIds = tugasData.map((t) => t.id)
      let jawabanQuery = supabase
        .from('tugas_jawaban')
        .select('id,tugas_id,user_id,nilai,status')
        .in('tugas_id', tugasIds)
        .is('nilai', null)
      const { data: jawabanData, error: jawabanError } = await jawabanQuery

      if (jawabanError) throw jawabanError

      const map = new Map()
      ;(jawabanData || []).forEach((j) => {
        const tugas = tugasData.find((t) => t.id === j.tugas_id)
        if (!tugas) return
        if (!map.has(j.tugas_id)) {
          const windowInfo = getTaskWindowInfo(tugas.mulai, tugas.deadline)
          map.set(j.tugas_id, {
            tugas: {
              ...tugas,
              kelasDisplay: formatKelasDisplay(tugas.kelas),
              isExpired: windowInfo.isExpired,
              isBeforeStart: windowInfo.isBeforeStart,
              isNearDeadline: windowInfo.isNearDeadline
            },
            jumlah: 0
          })
        }
        map.get(j.tugas_id).jumlah += 1
      })

      setTugasPerluDinilai(Array.from(map.values()).sort((a, b) => b.jumlah - a.jumlah))
    } catch (error) {
      console.error('Error loading tugas perlu dinilai:', error)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal memuat tugas perlu dinilai: ${parsed.message}`)
    } finally {
      setIsLoadingTugasPerluDinilai(false)
    }
  }, [applyPeriodFilters, user?.id])

  useEffect(() => {
    if (user?.id) loadTugasPerluDinilai()
  }, [user?.id, loadTugasPerluDinilai])

  /* =========================
     6) Detail Tugas (modal)
========================= */
  const loadDetailTugas = useCallback(
    async (tugas, { silent = false } = {}) => {
      if (!tugas || !user?.id) return
      const loadId = detailLoadIdRef.current + 1
      detailLoadIdRef.current = loadId

      if (!validateTugasAccess(tugas)) {
        pushToast('error', 'Anda tidak memiliki akses ke tugas ini')
        setSelectedTugas(null)
        return
      }
      if (!validateKelasAccess(myKelasList, tugas.kelas)) {
        pushToast('error', 'Anda tidak memiliki akses ke kelas ini')
        setSelectedTugas(null)
        return
      }

      try {
        if (!silent) {
          setIsLoadingDetail(true)
          setSiswaDiKelas([])
          setJawabanTugas([])
        }

        const siswaPromise = (async () => {
          // For archive periods, use student_class_histories to get the exact
          // roster for the year the tugas was created in.  This prevents
          // promoted students from showing up (or disappearing) in the
          // grading panel when the teacher views a historical assignment.
          const tugasYear = (tugas.tahun_ajaran || period.tahunAjaran || '').trim()
          if (isViewingArchivePeriod && tugasYear && tugas.kelas) {
            const { data: histRows } = await supabase
              .from('student_class_histories')
              .select('student_id')
              .eq('class_id', tugas.kelas)
              .eq('tahun_ajaran', tugasYear)
              .in('status', ['active', 'nonaktif', 'mutasi'])
            const histIds = (histRows || [])
              .map((r) => String(r.student_id || '').trim())
              .filter(Boolean)
            if (histIds.length) {
              let { data, error } = await supabase
                .from('profiles')
                .select('id, nama, photo_url, photo_path, kelas, role')
                .eq('role', 'siswa')
                .in('id', histIds)
                .order('nama')
              if (error && /photo_path/i.test(error.message || '')) {
                ;({ data, error } = await supabase
                  .from('profiles')
                  .select('id, nama, photo_url, kelas, role')
                  .eq('role', 'siswa')
                  .in('id', histIds)
                  .order('nama'))
              }
              return { data, error }
            }
          }

          // Current period (or no history data): fall back to profiles.kelas
          const kelasVariants = buildKelasVariants(tugas.kelas)
          const baseQuery = supabase
            .from('profiles')
            .select('id, nama, photo_url, photo_path, kelas, role')
            .eq('role', 'siswa')
            .in('kelas', kelasVariants)
            .order('nama')

          let { data, error } = await baseQuery

          if (error && /photo_path/i.test(error.message || '')) {
            ;({ data, error } = await supabase
              .from('profiles')
              .select('id, nama, photo_url, kelas, role')
              .eq('role', 'siswa')
              .in('kelas', kelasVariants)
              .order('nama'))
          }

          return { data, error }
        })()

        const jawabanPromise = supabase
          .from('tugas_jawaban')
          .select(TUGAS_JAWABAN_DETAIL_COLUMNS)
          .eq('tugas_id', tugas.id)

        const [
          { data: siswaData, error: siswaError },
          { data: jawabanData, error: jawabanError }
        ] = await Promise.all([siswaPromise, jawabanPromise])

        if (loadId !== detailLoadIdRef.current) {
          return
        }

        if (siswaError) throw siswaError
        if (jawabanError) throw jawabanError

        const normalizedSiswa =
          siswaData?.map((s) => ({
            ...s,
            photo_url: s.photo_path || s.photo_url || ''
          })) || []

        setSiswaDiKelas(normalizedSiswa)

        const formattedJawaban =
          jawabanData?.map((j) => ({
            ...j,
            nama: j.profiles?.nama,
            photo_url: j.profiles?.photo_url,
            uid: j.user_id
          })) || []

        setJawabanTugas(formattedJawaban)

        const submittedUnique = new Set(formattedJawaban.map((j) => j.user_id)).size
        const gradedCount = formattedJawaban.filter((j) => j.nilai != null).length
        const hasGradedSubmissions = gradedCount > 0
        setSelectedTugas((prev) => {
          if (!prev || prev.id !== tugas.id) return prev
          const nextStats = {
            ...(prev.stats || {}),
            total_siswa: normalizedSiswa.length,
            total_dikumpulkan: submittedUnique,
            sudah: gradedCount,
            belum_dinilai: Math.max(0, submittedUnique - gradedCount),
            belum_mengerjakan: Math.max(0, normalizedSiswa.length - submittedUnique)
          }
          const windowInfo = getTaskWindowInfo(prev.mulai, prev.deadline, nextStats)

          const prevStats = prev.stats || {}
          const statsUnchanged =
            Number(prevStats.total_siswa || 0) === Number(nextStats.total_siswa || 0) &&
            Number(prevStats.total_dikumpulkan || 0) === Number(nextStats.total_dikumpulkan || 0) &&
            Number(prevStats.sudah || 0) === Number(nextStats.sudah || 0) &&
            Number(prevStats.belum_dinilai || 0) === Number(nextStats.belum_dinilai || 0) &&
            Number(prevStats.belum_mengerjakan || 0) === Number(nextStats.belum_mengerjakan || 0)

          const flagsUnchanged =
            Boolean(prev.hasGradedSubmissions) === hasGradedSubmissions &&
            Boolean(prev.isExpired) === Boolean(windowInfo.isExpired) &&
            Boolean(prev.isBeforeStart) === Boolean(windowInfo.isBeforeStart) &&
            Boolean(prev.isNearDeadline) === Boolean(windowInfo.isNearDeadline) &&
            Boolean(prev.allSubmittedAndGraded) === Boolean(windowInfo.allSubmittedAndGraded)

          if (statsUnchanged && flagsUnchanged) {
            return prev
          }

          return {
            ...prev,
            stats: nextStats,
            hasGradedSubmissions,
            ...windowInfo
          }
        })

        setNilaiInput((prev) => {
          const next = { ...prev }
          formattedJawaban.forEach((j) => {
            if (j.nilai != null && next[j.user_id] === undefined) next[j.user_id] = String(j.nilai)
          })
          return next
        })
    } catch (error) {
      if (loadId !== detailLoadIdRef.current) {
        return
      }
      console.error('Error loading detail tugas:', error)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal memuat detail tugas: ${parsed.message}`)
    } finally {
      if (!silent && loadId === detailLoadIdRef.current) {
        setIsLoadingDetail(false)
      }
    }
  },
    [user?.id, validateTugasAccess, myKelasList, pushToast]
  )

  useEffect(() => {
    if (selectedTugas && !isEditingTugas) loadDetailTugas(selectedTugas)
  }, [selectedTugas, isEditingTugas, loadDetailTugas])

  /* =========================
     8) Realtime refresh (jawaban)
========================= */
  useEffect(() => {
    if (!user?.id) return

    const channel = supabase
      .channel(`tugas_jawaban_guru_${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tugas_jawaban' }, async (payload) => {
        await loadTugasPerluDinilai()
        await loadTugas()

        if (selectedTugas) {
          const changedTugasId =
            (payload.new && payload.new.tugas_id) || (payload.old && payload.old.tugas_id)
          if (changedTugasId === selectedTugas.id) {
            await loadDetailTugas(selectedTugas, { silent: true })
          }
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id, selectedTugas, loadTugasPerluDinilai, loadTugas, loadDetailTugas])

  /* =========================
     9) Group siswa status
========================= */
  const { siswaDinilai, siswaDikerjakan, siswaBelum } = useMemo(() => {
    const siswaDinilaiArr = siswaDiKelas
      .filter((s) => {
        const j = jawabanTugas.find((x) => x.user_id === s.id)
        return j?.nilai != null
      })
      .map((s) => ({ ...s, jawaban: jawabanTugas.find((x) => x.user_id === s.id) }))

    const siswaDikerjakanArr = siswaDiKelas
      .filter((s) => {
        const j = jawabanTugas.find((x) => x.user_id === s.id)
        return j && j.nilai == null
      })
      .map((s) => ({ ...s, jawaban: jawabanTugas.find((x) => x.user_id === s.id) }))

    const siswaBelumArr = siswaDiKelas.filter((s) => !jawabanTugas.find((x) => x.user_id === s.id))

    return { siswaDinilai: siswaDinilaiArr, siswaDikerjakan: siswaDikerjakanArr, siswaBelum: siswaBelumArr }
  }, [siswaDiKelas, jawabanTugas])

  /* =========================
     10) Upload file lampiran (create/edit)
========================= */
  const handleFileUpload = async (files, mode = 'create') => {
    if (!files?.length || !user?.id) return
    const file = files[0]
    const animationStartedAt = Date.now()
    let uploadController = null

    try {
      uploadAbortRef.current?.abort()
      uploadController = new AbortController()
      uploadAbortRef.current = uploadController
      setIsUploadingFile(true)
      setUploadProvider(null)
      setUploadPercent(null)
      setCompressionProgress('Mengkompresi file...')

      const compressed = await compressFileBeforeUpload(file)

      const safeName = sanitizeFileName(compressed.name)
      const filePath = `tugas_lampiran/${user.id}/${Date.now()}-${safeName}`

      setCompressionProgress('Mengupload file lewat jalur cepat...')

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(ASSIGNMENT_BUCKET)
        .upload(filePath, compressed, {
          ...ASSIGNMENT_FAST_UPLOAD_OPTIONS,
          signal: uploadController.signal,
          onProgress: setUploadPercent
        })

      if (uploadError) {
        // RLS storage paling sering muncul di sini
        throw new Error(uploadError.message || 'Upload ditolak oleh policy storage')
      }

      const storedFileValue = uploadData?.path || uploadData?.fullPath || filePath
      const sizeLabel = uploadData?.uploadedSizeLabel || formatFileSize(uploadData?.uploadedSizeBytes || compressed.size)
      const storedProvider = ['google_drive', 'object_storage'].includes(uploadData?.provider)
        ? uploadData.provider
        : 'local'
      setUploadProvider(storedProvider)

      if (mode === 'edit') {
        const oldPendingFile = pendingEditFile?.value
        if (oldPendingFile && oldPendingFile !== storedFileValue) {
          try {
            await deleteTeacherAttachment(oldPendingFile, user.id)
          } catch (e) {
            console.warn('Gagal menghapus file edit sementara:', e)
          }
        }

        setEditForm((prev) => ({ ...prev, file_url: storedFileValue }))
        setPendingEditFile({ value: storedFileValue, sizeLabel, provider: storedProvider })
        setUploadedFileSizeEdit(sizeLabel)
        setEditExistingFileSize(sizeLabel)
      } else {
        const currentFile = form.file_url
        if (currentFile) {
          try {
            await deleteTeacherAttachment(currentFile, user.id)
          } catch (e) {
            console.warn('Gagal menghapus file lama:', e)
          }
        }

        const nextPendingFile = { value: storedFileValue, sizeLabel, provider: storedProvider }
        setForm((prev) => ({ ...prev, file_url: storedFileValue }))
        pendingCreateFileRef.current = nextPendingFile
        setPendingCreateFile(nextPendingFile)
        setUploadedFileSizeCreate(sizeLabel)
      }

      setCompressionProgress(null)

      pushToast('success', `File berhasil diupload (${sizeLabel})`)
    } catch (error) {
      console.error('Upload error:', error)
      setCompressionProgress(null)
      setUploadPercent(null)
      const parsed = parseSupabaseError(error)
      // bantu diagnosa biar cepat
      if (parsed.code === 'rls_denied' || parsed.code === 'storage_policy_recursion') {
        pushToast('error', `Upload ditolak oleh policy storage: ${parsed.message}`)
      } else {
        pushToast('error', `Gagal mengupload file: ${parsed.message}`)
      }
    } finally {
      await holdUploadAnimation(animationStartedAt)
      setIsUploadingFile(false)
      setUploadProvider(null)
      setUploadPercent(null)
      if (uploadAbortRef.current === uploadController) {
        uploadAbortRef.current = null
      }
    }
  }

  const handleEditFileUpload = async (files) => handleFileUpload(files, 'edit')

  const discardPendingCreateFile = useCallback(async () => {
    const pendingValue = pendingCreateFile?.value
    if (!pendingValue || !user?.id) return

    try {
      await deleteTeacherAttachment(pendingValue, user.id)
    } catch (error) {
      console.warn('Gagal menghapus file create sementara:', error)
    } finally {
      pendingCreateFileRef.current = null
      setPendingCreateFile(null)
    }
  }, [pendingCreateFile?.value, user?.id])

  const resetCreateFormState = useCallback(() => {
    const mulai = clampDateTimeLocal(getNowDateTimeLocal(), createPeriodBounds.min, createPeriodBounds.endsAt)
    const deadline = clampDateTimeLocal(mulai, mulai, createPeriodBounds.endsAt)
    setForm({ judul: '', keterangan: '', link: '', mulai, deadline, file_url: '' })
    setUploadedFileSizeCreate('')
    pendingCreateFileRef.current = null
    setPendingCreateFile(null)
  }, [createPeriodBounds.endsAt, createPeriodBounds.min])

  const cancelCreateTugas = useCallback(async () => {
    await discardPendingCreateFile()
    resetCreateFormState()
    setIsCreatePanelOpen(false)
    pushToast('info', 'Pembuatan tugas dibatalkan')
  }, [discardPendingCreateFile, pushToast, resetCreateFormState])

  const discardPendingEditFile = useCallback(async () => {
    const pendingValue = pendingEditFile?.value
    if (!pendingValue || !user?.id) return

    try {
      await deleteTeacherAttachment(pendingValue, user.id)
    } catch (error) {
      console.warn('Gagal menghapus file edit sementara:', error)
    } finally {
      setPendingEditFile(null)
    }
  }, [pendingEditFile?.value, user?.id])

  const resetEditState = useCallback(() => {
    setIsEditingTugas(false)
    setEditForm(null)
    setUploadedFileSizeEdit('')
    setEditExistingFileSize('')
    setEditOriginalFile('')
    setPendingEditFile(null)
  }, [])

  const cancelEditTugas = useCallback(async () => {
    await discardPendingEditFile()
    resetEditState()
  }, [discardPendingEditFile, resetEditState])

  const closeSelectedTugas = useCallback(async () => {
    await discardPendingEditFile()
    setSelectedTugas(null)
    resetEditState()
  }, [discardPendingEditFile, resetEditState])

  const removeEditAttachment = useCallback(async () => {
    const pendingValue = pendingEditFile?.value
    if (pendingValue && editForm?.file_url === pendingValue && user?.id) {
      try {
        await deleteTeacherAttachment(pendingValue, user.id)
      } catch (e) {
        console.warn('Gagal menghapus file edit sementara:', e)
      }
      setPendingEditFile(null)
    }

    setEditForm((prev) => ({ ...prev, file_url: '' }))
    setUploadedFileSizeEdit('')
    setEditExistingFileSize('')
  }, [editForm?.file_url, pendingEditFile?.value, user?.id])

  /* =========================
     11) Get old file size (edit)
========================= */
  useEffect(() => {
    let cancelled = false

    const fetchOldSize = async () => {
      if (!isEditingTugas || !editForm?.file_url || !user?.id) {
        setEditExistingFileSize('')
        setUploadedFileSizeEdit('')
        return
      }

      try {
        const key = normalizeAssignmentKey(editForm.file_url)
        if (!key) return

        // ANTI-IDOR: file lampiran guru harus di folder guru
        if (!String(key).startsWith(`tugas_lampiran/${user.id}/`)) return

        const signed = await createSignedUrlForAssignment(key, 60 * 10)
        const res = await fetch(signed)
        if (!res.ok) return
        const blob = await res.blob()
        if (!cancelled) setEditExistingFileSize(formatFileSize(blob.size))
      } catch (err) {
        console.error('Gagal mengambil ukuran file lampiran:', err)
      }
    }

    fetchOldSize()
    return () => {
      cancelled = true
    }
  }, [isEditingTugas, editForm?.file_url, user?.id])

  /* =========================
     12) Create / Update / Delete tugas
========================= */
  const tambahTugas = async () => {
    if (!kelas || !selectedMapel || !form.judul || !form.mulai || !form.deadline) {
      pushToast('error', 'Lengkapi data (Kelas, Mapel, Judul, Mulai, Deadline)')
      return
    }
    if (!validateKelasAccess(myKelasList, kelas)) {
      pushToast('error', 'Anda tidak memiliki akses ke kelas ini')
      return
    }

    const timelineError = validateTimelineInput(form.mulai, form.deadline)
    const periodTimelineError = validateTimelineInput(form.mulai, form.deadline, {
      periodStart: createPeriodBounds.startsAt,
      periodEnd: createPeriodBounds.endsAt,
      periodLabel: createPeriodBounds.label
    })
    if (timelineError || periodTimelineError) {
      pushToast('error', timelineError || periodTimelineError)
      return
    }

    const safeLink = normalizeOptionalUrl(form.link)
    if (String(form.link || '').trim() && !safeLink) {
      pushToast('error', 'Link referensi tidak valid')
      return
    }

    try {
      setLoading(true)

      const payload = {
        kelas,
        mapel: selectedMapel,
        judul: form.judul,
        keterangan: form.keterangan,
        link: safeLink || null,
        mulai: new Date(form.mulai).toISOString(),
        deadline: new Date(form.deadline).toISOString(),
        file_url: form.file_url, // simpan PATH (bukan URL)
        created_by: user.id,
        ...activeAcademicPeriodPayload
      }

      const { error } = await supabase.from('tugas').insert(payload)
      if (error) throw error

      pushToast('success', 'Tugas berhasil ditambahkan')
      resetCreateFormState()
      setIsCreatePanelOpen(false)

      await loadTugas()
      await loadTugasPerluDinilai()
    } catch (error) {
      console.error('Error adding tugas:', error)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal menambahkan tugas: ${parsed.message}`)
    } finally {
      setLoading(false)
    }
  }

  const openEditTugas = () => {
    if (!selectedTugas || !validateTugasAccess(selectedTugas)) {
      pushToast('error', 'Anda tidak memiliki akses untuk mengedit tugas ini')
      return
    }

    const originalFile = selectedTugas.file_url || ''
    const originalMulai = toDatetimeLocalValue(selectedTugas.mulai || selectedTugas.created_at)
    const originalDeadline = toDatetimeLocalValue(selectedTugas.deadline)
    setEditForm({
      id: selectedTugas.id,
      kelas: selectedTugas.kelas,
      mapel: selectedTugas.mapel,
      judul: selectedTugas.judul,
      keterangan: selectedTugas.keterangan || '',
      link: selectedTugas.link || '',
      mulai: originalMulai,
      deadline: originalDeadline,
      originalMulai,
      originalDeadline,
      file_url: originalFile,
      created_by: selectedTugas.created_by,
      hasGradedSubmissions: Boolean(selectedTugas.hasGradedSubmissions || (selectedTugas.stats?.sudah || 0) > 0)
    })
    setIsEditingTugas(true)
    setUploadedFileSizeEdit('')
    setEditExistingFileSize('')
    setEditOriginalFile(originalFile)
    setPendingEditFile(null)
  }

  const simpanEditTugas = async () => {
    if (!editForm || !user?.id) return

    if (editForm.created_by !== user.id) {
      pushToast('error', 'Anda tidak memiliki akses untuk mengedit tugas ini')
      await cancelEditTugas()
      return
    }

    if (!validateKelasAccess(myKelasList, editForm.kelas)) {
      pushToast('error', 'Anda tidak memiliki akses ke kelas ini')
      return
    }

    const mulaiChanged = String(editForm.mulai || '') !== String(editForm.originalMulai || '')
    const deadlineChanged = String(editForm.deadline || '') !== String(editForm.originalDeadline || '')
    const timelineError = validateTimelineInput(editForm.mulai, editForm.deadline, {
      allowPastStart: !mulaiChanged,
      allowPastDeadline: !deadlineChanged,
      periodStart: createPeriodBounds.startsAt,
      periodEnd: createPeriodBounds.endsAt,
      periodLabel: createPeriodBounds.label
    })
    if (timelineError) {
      pushToast('error', timelineError)
      return
    }

    const safeLink = normalizeOptionalUrl(editForm.link)
    if (String(editForm.link || '').trim() && !safeLink) {
      pushToast('error', 'Link referensi tidak valid')
      return
    }

    try {
      setLoading(true)

      const payload = {
        judul: editForm.judul,
        keterangan: editForm.keterangan,
        link: safeLink || null,
        file_url: editForm.file_url,
        updated_at: new Date().toISOString()
      }
      if (mulaiChanged) payload.mulai = new Date(editForm.mulai).toISOString()
      if (deadlineChanged) payload.deadline = new Date(editForm.deadline).toISOString()

      const { error } = await supabase
        .from('tugas')
        .update(payload)
        .eq('id', editForm.id)
        .eq('created_by', user.id)

      if (error) throw error

      if (editOriginalFile && editOriginalFile !== editForm.file_url) {
        try {
          await deleteTeacherAttachment(editOriginalFile, user.id)
        } catch (deleteError) {
          console.warn('Gagal menghapus file lampiran lama:', deleteError)
        }
      }

      pushToast('success', 'Tugas berhasil diperbarui')
      setSelectedTugas((prev) => {
        if (!prev) return prev
        const merged = { ...prev, ...payload }
        const windowInfo = getTaskWindowInfo(merged.mulai, merged.deadline, merged.stats)
        return { ...merged, ...windowInfo }
      })
      setIsEditingTugas(false)
      setEditForm(null)
      setUploadedFileSizeEdit('')
      setEditExistingFileSize('')
      setEditOriginalFile('')
      setPendingEditFile(null)

      await loadTugas()
    } catch (error) {
      console.error('Error updating tugas:', error)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal memperbarui tugas: ${parsed.message}`)
    } finally {
      setLoading(false)
    }
  }

  const hapusTugas = async (tugasId, fileUrlOrKey) => {
    if (!tugasId || !user?.id) return

    const tugas = listTugas.find((t) => t.id === tugasId) || selectedTugas
    if (!tugas || !validateTugasAccess(tugas)) {
      pushToast('error', 'Anda tidak memiliki akses untuk menghapus tugas ini')
      return
    }

    const hasGraded =
      Boolean(tugas?.hasGradedSubmissions) ||
      Number(tugas?.stats?.sudah || 0) > 0 ||
      (selectedTugas?.id === tugasId && jawabanTugas.some((j) => j.nilai != null))
    if (hasGraded) {
      pushToast('error', 'Tugas yang sudah memiliki nilai tidak boleh dihapus')
      return
    }

    // eslint-disable-next-line no-restricted-globals
    if (!confirm('Apakah Anda yakin ingin menghapus tugas ini?')) return

    try {
      setLoading(true)

      if (fileUrlOrKey) {
        try {
          await deleteTeacherAttachment(fileUrlOrKey, user.id)
        } catch (e) {
          console.warn('Gagal menghapus file lampiran:', e)
        }
      }

      const { error } = await supabase.from('tugas').delete().eq('id', tugasId).eq('created_by', user.id)
      if (error) throw error

      pushToast('success', 'Tugas berhasil dihapus')
      setSelectedTugas(null)
      setIsEditingTugas(false)
      setEditForm(null)
      setUploadedFileSizeEdit('')
      setEditExistingFileSize('')
      setEditOriginalFile('')
      setPendingEditFile(null)

      await loadTugas()
      await loadTugasPerluDinilai()
    } catch (error) {
      console.error('Error deleting tugas:', error)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal menghapus tugas: ${parsed.message}`)
    } finally {
      setLoading(false)
    }
  }

  /* =========================
     13) Simpan nilai siswa
     FIX: jangan update kolom yang tidak ada (dinilai_at/dinilai_oleh)
========================= */
  const simpanNilai = async (siswaId) => {
    if (!selectedTugas || !user?.id) return

    if (!validateTugasAccess(selectedTugas)) {
      pushToast('error', 'Anda tidak memiliki akses ke tugas ini')
      return
    }

    if (!siswaDiKelas.some((s) => s.id === siswaId)) {
      pushToast('error', 'Siswa tidak ditemukan di kelas ini')
      return
    }

    const nilai = nilaiInput[siswaId]
    if (nilai === undefined || nilai === '') {
      pushToast('error', 'Masukkan nilai terlebih dahulu')
      return
    }

    const parsed = parseInt(nilai, 10)
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
      pushToast('error', 'Nilai harus antara 0-100')
      return
    }

    try {
      setLoading(true)

      const existing = jawabanTugas.find((j) => j.user_id === siswaId)
      if (existing) {
        const { error } = await supabase
          .from('tugas_jawaban')
          .update({
            nilai: parsed,
            status: 'dinilai'
          })
          .eq('id', existing.id)
          .eq('tugas_id', selectedTugas.id)

        if (error) throw error
      } else {
        const { error } = await supabase.from('tugas_jawaban').insert({
          tugas_id: selectedTugas.id,
          user_id: siswaId,
          nilai: parsed,
          status: 'dinilai'
        })
        if (error) throw error
      }

      pushToast('success', 'Nilai berhasil disimpan')
      await loadDetailTugas(selectedTugas, { silent: true })
      await loadTugasPerluDinilai()
      await loadTugas()
    } catch (error) {
      console.error('Error saving nilai:', error)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal menyimpan nilai: ${parsed.message}`)
    } finally {
      setLoading(false)
    }
  }

  /* =========================
     14) Render helpers
========================= */
  const openPreviewAny = async (keyOrUrl, errorPrefix = 'Gagal membuka preview') => {
    const raw = String(keyOrUrl || '').trim()
    if (!hasUsableValue(raw)) {
      pushToast('error', 'File atau link tidak tersedia')
      return
    }

    try {
      const signed = await createSignedUrlForAssignment(raw, 60 * 30)
      setPreviewFile(signed)
    } catch (err) {
      console.error(err)
      const parsed = parseSupabaseError(err)
      if (parsed.code === 'rls_denied' || parsed.code === 'storage_policy_recursion') {
        pushToast('error', `${errorPrefix}: ${parsed.message}`)
      } else {
        pushToast('error', `${errorPrefix}: ${parsed.message}`)
      }
    }
  }

  const openPhotoGallery = async (values, initialIndex = 0, title = 'Galeri Jawaban Siswa') => {
    const items = parseAssignmentFileList(values).filter(isImageLikeFile).slice(0, MAX_ASSIGNMENT_PHOTOS)
    if (items.length === 0) {
      pushToast('error', 'Foto jawaban belum tersedia')
      return
    }

    try {
      const resolved = await Promise.all(
        items.map(async (item) => {
          if (/^https?:\/\//i.test(item)) return item
          if (looksLikeDomainUrl(item)) return `https://${item}`
          return createSignedUrlForAssignment(item, 60 * 30)
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

  const renderFileButton = (keyOrUrl, text, fileSize = '') => {
    if (!hasUsableValue(keyOrUrl)) return null

    const raw = String(keyOrUrl)
    const ext = raw.split('?')[0].split('.').pop()?.toLowerCase() || ''
    const isImage = ['jpeg', 'jpg', 'gif', 'png', 'webp', 'bmp'].includes(ext)
    const icon = isImage ? '🖼️' : '📄'

    const handlePreview = async (e) => {
      e.preventDefault()
      e.stopPropagation()
      await openPreviewAny(keyOrUrl, 'Gagal membuka preview file')
    }

    return (
      <button
        onClick={handlePreview}
        className="inline-flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg text-sm font-medium hover:from-blue-600 hover:to-blue-700 transition-all shadow-md"
        type="button"
      >
        <span className="text-base">{icon}</span>
        <span>
          {text}
          {fileSize ? ` (${fileSize})` : ''}
        </span>
        <span className="opacity-80 text-blue-100 text-xs ml-1">👁️</span>
      </button>
    )
  }

  const fileDisplayName = (value = '', fallback = 'Lampiran') => {
    const raw = String(value || '').split('?')[0].trim()
    const lastSegment = raw.split('/').filter(Boolean).pop()
    if (!lastSegment) return fallback

    try {
      return decodeURIComponent(lastSegment).replace(/^[a-f0-9-]{12,}-/i, '') || fallback
    } catch {
      return lastSegment || fallback
    }
  }

  const getSubmissionAssets = (jawaban) => {
    if (!jawaban) {
      return {
        photos: [],
        attachments: [],
        link: '',
        comment: ''
      }
    }

    const files = parseAssignmentFileList(jawaban.file_urls, jawaban.file_url)
    const photos = files.filter(isImageLikeFile).slice(0, MAX_ASSIGNMENT_PHOTOS)
    const attachments = files.filter((item) => !isImageLikeFile(item))

    return {
      photos,
      attachments,
      link: String(jawaban.link_url || '').trim(),
      comment: String(jawaban.komentar_siswa || '').trim()
    }
  }

  const getSubmissionSummary = (jawaban) => {
    const assets = getSubmissionAssets(jawaban)
    const fileCount = assets.photos.length + assets.attachments.length
    const parts = [
      {
        key: 'file',
        label: 'Foto/File',
        done: fileCount > 0,
        detail: fileCount > 0
          ? [
              assets.photos.length ? `${assets.photos.length} foto` : '',
              assets.attachments.length ? `${assets.attachments.length} lampiran` : ''
            ].filter(Boolean).join(', ')
          : 'Belum ada file',
        icon: fileCount > 0 && assets.photos.length > 0 ? ImageIcon : Paperclip
      },
      {
        key: 'link',
        label: 'Link',
        done: hasUsableValue(assets.link),
        detail: hasUsableValue(assets.link) ? 'Ada link' : 'Belum ada link',
        icon: Link2
      },
      {
        key: 'comment',
        label: 'Komentar',
        done: hasUsableValue(assets.comment),
        detail: hasUsableValue(assets.comment) ? 'Ada komentar' : 'Belum ada komentar',
        icon: MessageSquare
      }
    ]

    const completed = parts.filter((part) => part.done)
    const missing = parts.filter((part) => !part.done)
    const hasAnyAnswer = completed.length > 0
    const isComplete = completed.length === parts.length

    return {
      assets,
      parts,
      completed,
      missing,
      hasAnyAnswer,
      isComplete,
      label: isComplete ? 'Lengkap' : hasAnyAnswer ? 'Terkumpul' : 'Belum lengkap',
      className: isComplete
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : hasAnyAnswer
          ? 'border-amber-200 bg-amber-50 text-amber-700'
          : 'border-rose-200 bg-rose-50 text-rose-700'
    }
  }

  const renderSubmissionCompleteness = (jawaban) => {
    const summary = getSubmissionSummary(jawaban)
    const StatusIcon = summary.hasAnyAnswer ? CheckCircle2 : X

    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-extrabold ${summary.className}`}>
          <StatusIcon className="h-3.5 w-3.5" />
          {summary.label}
        </span>
      </div>
    )
  }

  const renderSubmissionViewer = (siswa, jawaban, options = {}) => {
    const { compact = false } = options
    const assets = getSubmissionAssets(jawaban)
    const hasAnswer =
      assets.photos.length > 0 ||
      assets.attachments.length > 0 ||
      hasUsableValue(assets.link) ||
      hasUsableValue(assets.comment)

    if (!hasAnswer) {
      return (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
          Tidak ada file, foto, link, atau komentar.
        </div>
      )
    }

    const containerClass = compact
      ? 'flex flex-wrap gap-2'
      : 'flex flex-wrap gap-2'
    const actionClass =
      'group flex min-h-[48px] max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:max-w-[260px]'
    const iconClass = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base'
    const textClass = 'min-w-0 flex-1'
    const titleClass = 'block truncate text-xs font-extrabold text-slate-900'
    const descClass = 'mt-0.5 block truncate text-[11px] font-medium text-slate-500'

    return (
      <div className={containerClass}>
        {assets.photos.length > 0 && (
          <button
            type="button"
            onClick={() => openPhotoGallery(assets.photos, 0, `Foto jawaban ${siswa.nama || 'Siswa'}`)}
            className={`${actionClass} border-emerald-200 bg-emerald-50 hover:border-emerald-300 hover:bg-emerald-100`}
          >
            <span className={`${iconClass} bg-emerald-100 text-emerald-700`}>🖼️</span>
            <span className={textClass}>
              <span className={titleClass}>Foto</span>
              <span className={descClass}>{assets.photos.length} foto • buka galeri</span>
            </span>
          </button>
        )}

        {assets.attachments.map((attachment, index) => (
          <button
            key={`${attachment}-${index}`}
            type="button"
            onClick={() => openPreviewAny(attachment, 'Gagal membuka lampiran jawaban')}
            className={`${actionClass} border-blue-200 bg-blue-50 hover:border-blue-300 hover:bg-blue-100`}
          >
            <span className={`${iconClass} bg-blue-100 text-blue-700`}>📄</span>
            <span className={textClass}>
              <span className={titleClass}>
                {assets.attachments.length > 1 ? `Lampiran ${index + 1}` : 'Lampiran'}
              </span>
              <span className={descClass}>{fileDisplayName(attachment, 'Preview file')}</span>
            </span>
          </button>
        ))}

        {hasUsableValue(assets.link) && (
          <button
            type="button"
            onClick={() => openPreviewAny(assets.link, 'Gagal membuka link jawaban')}
            className={`${actionClass} border-purple-200 bg-purple-50 hover:border-purple-300 hover:bg-purple-100`}
          >
            <span className={`${iconClass} bg-purple-100 text-purple-700`}>🔗</span>
            <span className={textClass}>
              <span className={titleClass}>Link</span>
              <span className={descClass}>{assets.link}</span>
            </span>
          </button>
        )}

        {hasUsableValue(assets.comment) && (
          <button
            type="button"
            onClick={() => setStudentCommentPreview({
              siswa: siswa.nama || jawaban?.nama || 'Siswa',
              kelas: siswa.kelas || '',
              waktu: jawaban?.waktu_submit || '',
              komentar: assets.comment
            })}
            className={`${actionClass} border-amber-200 bg-amber-50 hover:border-amber-300 hover:bg-amber-100`}
          >
            <span className={`${iconClass} bg-amber-100 text-amber-800`}>
              <MessageSquare className="h-4 w-4" />
            </span>
            <span className={textClass}>
              <span className={titleClass}>Komentar</span>
              <span className={descClass}>{assets.comment}</span>
            </span>
          </button>
        )}
      </div>
    )
  }

  const renderTabelSiswa = (siswaList, type) => {
    const typeInfo = (() => {
      switch (type) {
        case 'dinilai':
          return {
            title: '✅ Sudah Dinilai',
            bgColor: 'bg-green-50',
            borderColor: 'border-green-200',
            textColor: 'text-green-800',
            badge: 'bg-green-100 text-green-700 border-green-200'
          }
        case 'dikerjakan':
          return {
            title: '📝 Menunggu Dinilai',
            bgColor: 'bg-yellow-50',
            borderColor: 'border-yellow-200',
            textColor: 'text-yellow-800',
            badge: 'bg-yellow-100 text-yellow-700 border-yellow-200'
          }
        case 'belum':
          return {
            title: '⏳ Belum Mengerjakan',
            bgColor: 'bg-red-50',
            borderColor: 'border-red-200',
            textColor: 'text-red-800',
            badge: 'bg-red-100 text-red-700 border-red-200'
          }
        default:
          return {}
      }
    })()

    return (
      <div className={`rounded-2xl border ${typeInfo.borderColor} ${typeInfo.bgColor} p-4`}>
        <div className="flex items-center justify-between mb-4">
          <h4 className={`font-bold text-base ${typeInfo.textColor} flex items-center gap-2`}>
            <span>{typeInfo.title}</span>
          </h4>
          <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${typeInfo.badge}`}>
            {siswaList.length} siswa
          </span>
        </div>

        {siswaList.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <div className="text-4xl mb-2">🫧</div>
            <p>Tidak ada data</p>
          </div>
        ) : (
          <div className="space-y-3">
            {siswaList.map((siswa) => {
              const jawaban = siswa.jawaban
              const scoreLabel = jawaban?.nilai != null ? String(jawaban.nilai) : 'Menunggu'
              const scoreClass = jawaban?.nilai != null
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'

              return (
                <article key={siswa.id} className="rounded-2xl border border-white/80 bg-white p-4 shadow-sm ring-1 ring-slate-100/80">
                  <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_220px] lg:items-start">
                    <div className="min-w-0">
                      <div className="flex items-start gap-3">
                        <Avatar src={siswa.photo_url} name={siswa.nama} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-extrabold text-slate-900">{siswa.nama}</p>
                          <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{siswa.kelas || '-'}</p>
                          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                            <Clock className="h-3.5 w-3.5" />
                            {jawaban?.waktu_submit ? formatDateTime(jawaban.waktu_submit) : type === 'belum' ? 'Belum mengumpulkan' : '-'}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0">
                      {type === 'belum' ? (
                        <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                          Belum ada file, link, atau komentar jawaban.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {renderSubmissionCompleteness(jawaban)}
                          {renderSubmissionViewer(siswa, jawaban)}
                        </div>
                      )}
                    </div>

                    {type === 'belum' ? (
                      <div className="flex lg:justify-end">
                        <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-extrabold text-rose-700">
                          Belum mengumpulkan
                        </span>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <label htmlFor={`nilai-${siswa.id}`} className="block text-xs font-extrabold uppercase tracking-wide text-slate-500">
                            Nilai
                          </label>
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${scoreClass}`}>
                            {scoreLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            id={`nilai-${siswa.id}`}
                            type="number"
                            name={`nilai-${siswa.id}`}
                            aria-label={`Nilai ${siswa.nama || 'siswa'}`}
                            min="0"
                            max="100"
                            inputMode="numeric"
                            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            placeholder="0-100"
                            value={nilaiInput[siswa.id] ?? ''}
                            onChange={(e) => {
                              const val = e.target.value
                              if (val === '') return setNilaiInput((prev) => ({ ...prev, [siswa.id]: '' }))
                              const n = parseInt(val, 10)
                              if (!Number.isNaN(n) && n >= 0 && n <= 100) {
                                setNilaiInput((prev) => ({ ...prev, [siswa.id]: val }))
                              }
                            }}
                          />
                          <button
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-green-600 px-3 py-2 text-xs font-extrabold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={(e) => {
                              e.stopPropagation()
                              simpanNilai(siswa.id)
                            }}
                            disabled={loading}
                            type="button"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {loading ? '...' : 'Simpan'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    )
  }

	  const monthOptions = useMemo(() => (
	    (dateFilterPeriod.months || []).map((month) => ({
	      value: month.value,
	      label: month.label
	    }))
	  ), [dateFilterPeriod.months])

  const dashboardStats = useMemo(() => {
    const total = listTugas.length
    const now = new Date()
    const active = listTugas.filter((t) => t.deadline && new Date(t.deadline) >= now).length
    const expired = total - active
    const needGrade = listTugas.reduce((acc, t) => acc + (t.stats?.belum_dinilai || 0), 0)
    return { total, active, expired, needGrade }
  }, [listTugas])

  const selectedHasGradedSubmission = useMemo(() => {
    if (!selectedTugas) return false
    if (selectedTugas.hasGradedSubmissions) return true
    if (Number(selectedTugas.stats?.sudah || 0) > 0) return true
    return jawabanTugas.some((j) => j.nilai != null)
  }, [selectedTugas, jawabanTugas])

  /* =========================
     15) Main Render
========================= */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-4 sm:p-6">
      <div className="max-w-full mx-auto space-y-6">
        {/* HEADER */}
        <div className="page-title-card">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                <span className="text-2xl text-white">📚</span>
              </div>
              <div>
                <h1 className="page-title-heading">Kelola Tugas</h1>
                <p className="page-title-description">Buat, atur, dan nilai tugas untuk siswa Anda</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
                <div className="text-xs text-slate-500">Guru Pengampu</div>
                <div className="font-semibold text-slate-800">{profile?.nama || '-'}</div>
              </div>

              <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl px-5 py-3 shadow-lg">
                <div className="grid grid-cols-4 gap-4 text-white">
                  <div className="text-center">
                    <div className="text-xs opacity-90">Total</div>
                    <div className="text-lg font-bold">{dashboardStats.total}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs opacity-90">Aktif</div>
                    <div className="text-lg font-bold">{dashboardStats.active}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs opacity-90">Expired</div>
                    <div className="text-lg font-bold">{dashboardStats.expired}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs opacity-90">Perlu Nilai</div>
                    <div className="text-lg font-bold">{dashboardStats.needGrade}</div>
                  </div>
                </div>
              </div>

              <button
                onClick={async () => {
                  pushToast('info', 'Memperbarui data...')
                  await loadTugas()
                  await loadTugasPerluDinilai()
                  pushToast('success', 'Data diperbarui')
                }}
                className="px-4 py-3 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors font-semibold text-slate-700 shadow-sm"
                type="button"
              >
                🔄 Refresh
              </button>
            </div>
          </div>
        </div>

        {/* AKSI BUAT TUGAS */}
        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-green-50 text-green-700">
                <span className="text-lg">➕</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Buat Tugas Baru</h3>
                <p className="text-sm text-slate-500">
                  Form tugas disembunyikan agar halaman tetap ringkas. Tanggal hanya bisa dipilih dalam periode {createPeriodBounds.label}.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!isCreatePanelOpen) {
                  const mulai = clampDateTimeLocal(form.mulai || getNowDateTimeLocal(), createPeriodBounds.min, createPeriodBounds.endsAt)
                  const deadline = clampDateTimeLocal(form.deadline || mulai, mulai, createPeriodBounds.endsAt)
                  setForm((prev) => ({ ...prev, mulai, deadline }))
                }
                setIsCreatePanelOpen((open) => !open)
              }}
              className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold shadow-sm transition ${
                isCreatePanelOpen
                  ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800'
              }`}
            >
              {isCreatePanelOpen ? 'Tutup Form' : 'Buat Tugas Baru'}
            </button>
          </div>
        </div>

        {/* FORM BUAT TUGAS */}
        {isCreatePanelOpen && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6">
          <h3 className="text-xl font-bold text-slate-800 mb-5 flex items-center gap-3">
            <div className="w-9 h-9 bg-green-500 rounded-xl flex items-center justify-center shadow">
              <span className="text-white text-sm">➕</span>
            </div>
            <span>Buat Tugas Baru</span>
          </h3>

          <div className="sismu-filter-grid">
            <div className="sismu-filter-field">
              <label htmlFor="tugas-kelas" className="sismu-filter-label">Kelas</label>
              <select
                id="tugas-kelas"
                name="kelas"
                className="sismu-filter-control"
                value={kelas}
                onChange={(e) => setKelas(e.target.value)}
              >
                <option value="">— Pilih Kelas —</option>
                {myKelasList.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.nama}
                  </option>
                ))}
              </select>
              <p className="sismu-filter-help">Hanya kelas yang Anda ampu yang tampil.</p>
            </div>

            <div className="sismu-filter-field">
              <label htmlFor="tugas-mapel" className="sismu-filter-label">Mata Pelajaran</label>
              <select
                id="tugas-mapel"
                name="mapel"
                className="sismu-filter-control disabled:opacity-50"
                value={selectedMapel}
                onChange={(e) => setSelectedMapel(e.target.value)}
                disabled={!kelas || mapelList.length === 0}
              >
                <option value="">
                  — {kelas ? (mapelList.length > 0 ? 'Pilih Mapel' : 'Tidak ada mapel') : 'Pilih kelas dulu'} —
                </option>
                {mapelList.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="sismu-filter-field">
              <label htmlFor="tugas-judul" className="sismu-filter-label">Judul Tugas</label>
              <input
                id="tugas-judul"
                name="judul"
                className="sismu-filter-control"
                value={form.judul}
                onChange={(e) => setForm((prev) => ({ ...prev, judul: e.target.value }))}
                placeholder="Judul tugas..."
                maxLength={200}
              />
            </div>

            <div className="sismu-filter-field">
              <label htmlFor="tugas-mulai" className="sismu-filter-label">Mulai</label>
              <input
                id="tugas-mulai"
                name="mulai"
                type="datetime-local"
                className="sismu-filter-control"
                value={form.mulai}
                onChange={(e) => {
                  const mulai = clampDateTimeLocal(e.target.value, createPeriodBounds.min, createPeriodBounds.endsAt)
                  setForm((prev) => ({
                    ...prev,
                    mulai,
                    deadline: clampDateTimeLocal(prev.deadline, mulai, createPeriodBounds.endsAt)
                  }))
                }}
                min={createPeriodBounds.min}
                max={createPeriodBounds.endsAt || undefined}
              />
            </div>

            <div className="sismu-filter-field">
              <label htmlFor="tugas-deadline" className="sismu-filter-label">Deadline</label>
              <input
                id="tugas-deadline"
                name="deadline"
                type="datetime-local"
                className="sismu-filter-control"
                value={form.deadline}
                onChange={(e) => setForm((prev) => ({
                  ...prev,
                  deadline: clampDateTimeLocal(
                    e.target.value,
                    maxDateTimeLocal(createPeriodBounds.min, prev.mulai || createPeriodBounds.min),
                    createPeriodBounds.endsAt
                  )
                }))}
                min={maxDateTimeLocal(createPeriodBounds.min, form.mulai || createPeriodBounds.min)}
                max={createPeriodBounds.endsAt || undefined}
              />
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Periode tugas baru: <b>{createPeriodBounds.label}</b>
            {createPeriodBounds.startsAt && createPeriodBounds.endsAt ? (
              <span> ({createPeriodBounds.startsAt.slice(0, 10)} sampai {createPeriodBounds.endsAt.slice(0, 10)})</span>
            ) : null}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-4">
            <div>
              <label htmlFor="tugas-keterangan" className="block text-sm font-semibold text-slate-700 mb-2">Keterangan Tugas</label>
              <textarea
                id="tugas-keterangan"
                name="keterangan"
                rows="7"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white resize-none text-sm"
                value={form.keterangan}
                onChange={(e) => setForm((prev) => ({ ...prev, keterangan: e.target.value }))}
                placeholder="Tambahkan instruksi pengerjaan tugas..."
                maxLength={1000}
              />

              <div className="mt-4">
                <label htmlFor="tugas-link" className="block text-sm font-semibold text-slate-700 mb-2">Link Referensi (opsional)</label>
                <input
                  id="tugas-link"
                  name="link"
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                  value={form.link}
                  onChange={(e) => setForm((prev) => ({ ...prev, link: e.target.value }))}
                  placeholder="contoh: drive.google.com/... / youtube.com/... / website"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Link manual disimpan di database/VPS dan bisa dipreview overlay (Google Drive / YouTube / Website).
                </p>
              </div>
            </div>

            <div>
              <label htmlFor="tugas-lampiran" className="block text-sm font-semibold text-slate-700 mb-2">File Lampiran (opsional)</label>

              {isUploadingFile ? (
                <UploadProgressTrain
                  label={compressionProgress || 'Mengupload file...'}
                  detail={uploadDetailForProvider(uploadProvider, 'Lampiran tugas sedang diproses dan dikirim.')}
                  progress={uploadPercent}
                  tone={uploadToneForProvider(uploadProvider)}
                />
              ) : form.file_url ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl">
                    <div className="flex items-center gap-3">
                      <span className="text-green-600 text-lg">✅</span>
                      <div>
                        <div className="text-sm font-semibold text-green-800">File terlampir</div>
                        <div className="text-xs text-green-600">
                          {uploadedFileSizeCreate || 'Ukuran akan muncul setelah upload'} • Siap disimpan
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {renderFileButton(form.file_url, 'Preview', uploadedFileSizeCreate)}
                      <button
                        className="px-3 py-2 bg-red-100 text-red-700 rounded-lg text-xs hover:bg-red-200 transition-colors font-semibold"
                        onClick={async () => {
                          if (!form.file_url) return
                          try {
                            await deleteTeacherAttachment(form.file_url, user.id)
                            setForm((prev) => ({ ...prev, file_url: '' }))
                            setUploadedFileSizeCreate('')
                            pendingCreateFileRef.current = null
                            setPendingCreateFile(null)
                            pushToast('success', 'File berhasil dihapus')
                          } catch (error) {
                            pushToast('error', `Gagal menghapus file: ${error?.message || 'Unknown error'}`)
                          }
                        }}
                        type="button"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <FileDropzone
                  id="tugas-lampiran"
                  name="lampiran"
                  onFiles={(files) => handleFileUpload(files, 'create')}
                  accept={ASSIGNMENT_FILE_ACCEPT}
                  label="Seret file lampiran ke sini atau klik untuk memilih"
                />
              )}

              <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-xs font-semibold text-slate-700 mb-2">📋 Batas Ukuran File:</p>
                <ul className="text-xs text-slate-600 space-y-1">
                  <li>🖼️ Gambar: maks {formatFileSize(ASSIGNMENT_PHOTO_MAX_BYTES)}/foto, total sekitar {formatFileSize(ASSIGNMENT_PHOTOS_MAX_TOTAL_BYTES)}</li>
                  <li>📄 PDF/Dokumen: maks 3MB per file</li>
                  <li>📊 PPT: maks 5MB per file</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              className="sm:w-auto rounded-2xl border border-slate-300 bg-white px-6 py-4 text-base font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => { void cancelCreateTugas() }}
              disabled={loading || isUploadingFile || (!form.file_url && !form.judul && !form.keterangan && !form.link)}
              type="button"
            >
              Batal
            </button>
            <button
              className="flex flex-1 items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 text-base font-bold text-white shadow-lg transition-all hover:from-blue-700 hover:to-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={tambahTugas}
              disabled={loading || isUploadingFile || !kelas || !selectedMapel || !form.judul || !form.mulai || !form.deadline}
              type="button"
            >
              <span>{loading ? 'Menyimpan...' : 'Simpan Tugas Baru'}</span>
            </button>
          </div>
        </div>
        )}

        {/* GRID: SIDEBAR + MAIN */}
        <div className="grid xl:grid-cols-4 gap-6">
          {/* SIDEBAR */}
          <div className="xl:col-span-1 space-y-6">
            {/* Tugas perlu dinilai */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-3">
                <div className="w-8 h-8 bg-red-500 rounded-xl flex items-center justify-center">
                  <span className="text-white text-sm">📝</span>
                </div>
                <span>Tugas Perlu Dinilai</span>
              </h3>

              {isLoadingTugasPerluDinilai ? (
                <div className="text-center py-8">
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-slate-500 text-sm">Memuat data...</p>
                </div>
              ) : tugasPerluDinilai.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <div className="text-4xl mb-2">✅</div>
                  <p className="text-sm">Tidak ada yang menunggu dinilai</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tugasPerluDinilai.slice(0, 8).map((item) => (
                    <button
                      key={item.tugas.id}
                      type="button"
                      onClick={() => {
                        setSelectedTugas(item.tugas)
                        setIsEditingTugas(false)
                        setEditForm(null)
                      }}
                      className="w-full text-left p-4 rounded-2xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-800 truncate">{item.tugas.judul}</div>
                          <div className="text-xs text-slate-500 mt-1">
                            {item.tugas.kelasDisplay} • {item.tugas.mapel}
                          </div>
                        </div>
                        <span className="px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-bold whitespace-nowrap">
                          {item.jumlah} belum
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-2">
                        Deadline: {formatDateTime(item.tugas.deadline)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Filter History */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-3">
                <div className="w-8 h-8 bg-indigo-500 rounded-xl flex items-center justify-center">
                  <span className="text-white text-sm">🎛️</span>
                </div>
                <span>Filter Riwayat</span>
              </h3>

              <div className="space-y-3">
                <div className="sismu-filter-field">
                  <label htmlFor="filter-tugas-cari" className="sismu-filter-label">Cari tugas</label>
                  <input
                    id="filter-tugas-cari"
                    name="filter_tugas_cari"
                    className="sismu-filter-control"
                    value={historySearchTerm}
                    onChange={(e) => setHistorySearchTerm(e.target.value)}
                    placeholder="Judul, mapel, kelas..."
                  />
                </div>

                <div className="sismu-filter-field">
                  <label htmlFor="filter-tugas-kelas" className="sismu-filter-label">Kelas</label>
                  <select
                    id="filter-tugas-kelas"
                    name="filter_kelas"
                    className="sismu-filter-control"
                    value={selectedKelasFilter}
                    onChange={(e) => setSelectedKelasFilter(e.target.value)}
                  >
                    <option value="">Semua kelas</option>
                    {myKelasList.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.nama}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sismu-filter-field">
                  <label htmlFor="filter-tugas-mapel" className="sismu-filter-label">Mapel</label>
                  <select
                    id="filter-tugas-mapel"
                    name="filter_mapel"
                    className="sismu-filter-control disabled:opacity-50"
                    value={selectedSubject}
                    onChange={(e) => setSelectedSubject(e.target.value)}
                    disabled={!selectedKelasFilter || mapelListFilter.length === 0}
                  >
                    <option value="">{selectedKelasFilter ? 'Semua mapel' : 'Pilih kelas dulu'}</option>
                    {mapelListFilter.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sismu-filter-field">
                  <label htmlFor="filter-tugas-status" className="sismu-filter-label">Status Deadline</label>
                  <select
                    id="filter-tugas-status"
                    name="filter_status"
                    className="sismu-filter-control"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                  >
                    <option value="all">Semua</option>
                    <option value="active">Aktif</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>

                <AcademicPeriodArchiveFilter
                  activeAcademicPeriod={activeAcademicPeriod}
                  periodFilter={periodFilter}
                  academicYearOptions={academicYearOptions}
                  semesterOptions={semesterOptions}
                  setAcademicYear={setAcademicYear}
                  setSemester={setSemester}
                  resetToActivePeriod={resetToActivePeriod}
                  title="Periode Riwayat"
                  compact
                />

                <div className="sismu-filter-field">
                  <label htmlFor="filter-tugas-rentang-waktu" className="sismu-filter-label">Rentang Waktu</label>
                  <select
                    id="filter-tugas-rentang-waktu"
                    name="filter_rentang_waktu"
                    className="sismu-filter-control"
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value)}
                  >
                    <option value="recent">10 tugas terbaru</option>
                    <option value="week">7 hari terakhir</option>
                    <option value="all">Semua bulan periode</option>
                    <option value="custom_months">Pilih bulan</option>
                  </select>
                </div>

                {timeRange === 'custom_months' && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="text-xs font-semibold text-slate-700 mb-2">Pilih bulan (multi)</div>
                    <div className="space-y-2 max-h-56 overflow-auto pr-1">
                      {monthOptions.map((m) => {
                        const checked = selectedMonths.includes(m.value)
                        const monthInputId = `filter-bulan-${String(m.value).replace(/[^a-zA-Z0-9_-]/g, '-')}`
                        return (
                          <label key={m.value} htmlFor={monthInputId} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              id={monthInputId}
                              type="checkbox"
                              name="filter_bulan"
                              value={m.value}
                              checked={checked}
                              onChange={(e) => {
                                const isOn = e.target.checked
                                setSelectedMonths((prev) => {
                                  if (isOn) return Array.from(new Set([...prev, m.value]))
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

                <button
                  type="button"
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors font-semibold text-slate-700"
                  onClick={() => {
                    setSelectedKelasFilter('')
                    setSelectedSubject('')
                    setFilterStatus('all')
                    setTimeRange('recent')
                    setSelectedMonths([])
                    setHistorySearchTerm('')
                    pushToast('info', 'Filter direset')
                  }}
                >
                  ♻️ Reset Filter
                </button>
              </div>
            </div>
          </div>

          {/* MAIN */}
          <div className="xl:col-span-3 space-y-6">
            {/* List tugas */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <span>📜</span>
                    <span>Riwayat Tugas</span>
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">Klik salah satu tugas untuk melihat jawaban dan memberi nilai.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!hasActiveHistoryFilter && (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      10 tugas terbaru
                    </span>
                  )}
                  {debouncedHistorySearchTerm && (
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                      Cari: {debouncedHistorySearchTerm}
                    </span>
                  )}
                  {selectedKelasFilter && (
                    <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
                      Kelas: {selectedHistoryKelasName}
                    </span>
                  )}
                  {selectedSubject && (
                    <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-700">
                      Mapel: {selectedSubject}
                    </span>
                  )}
                  {filterStatus !== 'all' && (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                      Status: {filterStatus === 'active' ? 'Aktif' : 'Expired'}
                    </span>
                  )}
                </div>
              </div>

              {loading && listTugas.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                  <div className="space-y-3">
                    {[0, 1, 2].map((item) => (
                      <div key={item} className="h-24 animate-pulse rounded-2xl bg-white shadow-sm" />
                    ))}
                  </div>
                </div>
              ) : listTugas.length === 0 ? (
                <div className="text-center py-14 text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
                  <div className="text-6xl mb-4">🗂️</div>
                  <div className="font-bold text-slate-700">Belum ada tugas</div>
                  <div className="text-sm mt-1">Coba ubah filter atau buat tugas baru.</div>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {listTugas.map((t) => {
                    const needGrade = t.stats?.belum_dinilai || 0
                    const totalSiswa = t.stats?.total_siswa || 0
                    const submitted = t.stats?.total_dikumpulkan || 0
                    const graded = t.stats?.sudah || 0
                    const belum = t.stats?.belum_mengerjakan || 0

                    const windowInfo = getTaskWindowInfo(t.mulai, t.deadline, t.stats, new Date())
                    const isExpired = windowInfo.isExpired
                    const isNearDeadline = windowInfo.isNearDeadline
                    const allSubmittedAndGraded = windowInfo.allSubmittedAndGraded
                    const cardTone = allSubmittedAndGraded
                      ? 'border-green-200 bg-green-50/50'
                      : isExpired
                      ? 'border-red-200 bg-red-50/40'
                      : isNearDeadline
                      ? 'border-yellow-200 bg-yellow-50/50'
                      : 'border-slate-200 bg-white'

                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          if (!validateTugasAccess(t)) return pushToast('error', 'Akses ditolak')
                          if (!validateKelasAccess(myKelasList, t.kelas)) return pushToast('error', 'Anda tidak punya akses ke kelas ini')
                          setSelectedTugas(t)
                          setIsEditingTugas(false)
                          setEditForm(null)
                        }}
                        className={`text-left p-5 rounded-2xl border transition-all hover:shadow-md ${cardTone}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-extrabold text-slate-800 truncate">{t.judul}</div>
                            <div className="text-xs text-slate-500 mt-1">
                              {t.kelasDisplay} • {t.mapel}
                            </div>
                          </div>

                          {allSubmittedAndGraded ? (
                            <span className="px-2 py-1 rounded-full bg-green-100 text-green-800 text-xs font-extrabold whitespace-nowrap">
                              Tuntas ✅
                            </span>
                          ) : needGrade > 0 ? (
                            <span className="px-2 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs font-extrabold whitespace-nowrap">
                              {needGrade} menunggu
                            </span>
                          ) : isNearDeadline ? (
                            <span className="px-2 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs font-extrabold whitespace-nowrap">
                              Deadline dekat
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded-full bg-green-100 text-green-800 text-xs font-extrabold whitespace-nowrap">
                              Aman ✅
                            </span>
                          )}
                        </div>

                        <div className="mt-3 text-xs text-slate-600">
                          Mulai:{' '}
                          <span className={`${t.isBeforeStart ? 'text-blue-700 font-semibold' : 'font-semibold'}`}>
                            {formatDateTime(t.mulai || t.created_at)}
                          </span>
                        </div>

                        <div className="mt-1 text-xs text-slate-600">
                          Deadline:{' '}
                          <span className={`${isExpired ? 'text-red-700 font-semibold' : 'font-semibold'}`}>
                            {formatDateTime(t.deadline)}
                          </span>
                        </div>

                        {(t.file_url || t.link) && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {t.file_url && (
                              <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-semibold">
                                📎 Lampiran
                              </span>
                            )}
                            {t.link && (
                              <span className="px-2 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200 text-[11px] font-semibold">
                                🔗 Link
                              </span>
                            )}
                          </div>
                        )}

                        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                          <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
                            <div className="text-[11px] text-slate-500">Siswa</div>
                            <div className="font-extrabold text-slate-800">{totalSiswa}</div>
                          </div>
                          <div className="p-2 rounded-xl bg-blue-50 border border-blue-200">
                            <div className="text-[11px] text-blue-700">Submit</div>
                            <div className="font-extrabold text-blue-800">{submitted}</div>
                          </div>
                          <div className="p-2 rounded-xl bg-green-50 border border-green-200">
                            <div className="text-[11px] text-green-700">Dinilai</div>
                            <div className="font-extrabold text-green-800">{graded}</div>
                          </div>
                          <div className="p-2 rounded-xl bg-red-50 border border-red-200">
                            <div className="text-[11px] text-red-700">Belum</div>
                            <div className="font-extrabold text-red-800">{belum}</div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* MODAL DETAIL / EDIT */}
        {selectedTugas && (
          <div className="fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => { void closeSelectedTugas() }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  void closeSelectedTugas()
                }
              }}
            />

            <div className="absolute inset-0 flex items-end justify-center p-0 sm:items-center sm:p-6">
              <div className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:max-h-[94vh] sm:rounded-3xl">
                {/* Header modal */}
                <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="h-11 w-1.5 rounded-full bg-blue-600" />
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-sm font-bold text-blue-700">
                          TG
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-lg font-bold text-slate-950 sm:text-2xl">
                            {selectedTugas.judul}
                          </div>
                          <div className="mt-1 text-sm text-slate-600">
                            {formatKelasDisplay(selectedTugas.kelas)} • {selectedTugas.mapel}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                          Dibuat: {formatDateTime(selectedTugas.created_at)}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 font-semibold ${
                            selectedTugas.isBeforeStart ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          Mulai: {formatDateTime(selectedTugas.mulai || selectedTugas.created_at)}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 font-semibold ${
                            selectedTugas.isExpired
                              ? 'bg-red-100 text-red-700'
                              : selectedTugas.isNearDeadline
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-green-100 text-green-700'
                          }`}
                        >
                          Deadline: {formatDateTime(selectedTugas.deadline)}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-bold text-slate-700">
                          Total: {siswaDiKelas.length}
                        </span>
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 font-bold text-blue-700">
                          Mengumpulkan: {jawabanTugas.length}
                        </span>
                        <span className="rounded-full border border-yellow-200 bg-yellow-50 px-3 py-1 font-bold text-yellow-800">
                          Menunggu: {siswaDikerjakan.length}
                        </span>
                        <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 font-bold text-green-700">
                          Dinilai: {siswaDinilai.length}
                        </span>
                      </div>
                    </div>

                    <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
                      {selectedTugas.file_url && (
                        <button
                          type="button"
                          onClick={() => openPreviewAny(selectedTugas.file_url, 'Gagal membuka lampiran tugas')}
                          className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 sm:w-auto"
                        >
                          Lampiran
                        </button>
                      )}
                      {selectedTugas.link && (
                        <button
                          type="button"
                          onClick={() => openPreviewAny(selectedTugas.link, 'Gagal membuka link referensi')}
                          className="w-full rounded-xl bg-purple-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-700 sm:w-auto"
                        >
                          Link Referensi
                        </button>
                      )}

                      {!isEditingTugas ? (
                        <>
                          <button
                            type="button"
                            onClick={openEditTugas}
                            disabled={loading || isUploadingFile}
                            className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => hapusTugas(selectedTugas.id, selectedTugas.file_url)}
                            disabled={selectedHasGradedSubmission || loading || isUploadingFile}
                            className="w-full rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                          >
                            {selectedHasGradedSubmission ? 'Tidak Bisa Hapus' : 'Hapus'}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={simpanEditTugas}
                            disabled={loading || isUploadingFile}
                            className="w-full rounded-xl bg-green-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                          >
                            {loading ? 'Menyimpan...' : 'Simpan'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { void cancelEditTugas() }}
                            disabled={loading || isUploadingFile}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                          >
                            Batal
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => { void closeSelectedTugas() }}
                        className="flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 sm:w-auto"
                        aria-label="Tutup detail tugas"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Body modal */}
                <div className="flex-1 overflow-auto p-4 sm:p-6">
                  {/* Edit Form */}
                  {isEditingTugas && editForm ? (
                    <div className="space-y-5">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label htmlFor="edit-tugas-judul" className="block text-sm font-semibold text-slate-700 mb-2">Judul</label>
                          <input
                            id="edit-tugas-judul"
                            name="edit_judul"
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                            value={editForm.judul}
                            onChange={(e) => setEditForm((p) => ({ ...p, judul: e.target.value }))}
                            maxLength={200}
                          />
                        </div>

                        <div>
                          <label htmlFor="edit-tugas-mulai" className="block text-sm font-semibold text-slate-700 mb-2">Mulai</label>
                          <input
                            id="edit-tugas-mulai"
                            name="edit_mulai"
                            type="datetime-local"
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                            value={editForm.mulai}
                            onChange={(e) => {
                              const min = isPastDateTimeLocal(editForm.originalMulai)
                                ? createPeriodBounds.startsAt
                                : createPeriodBounds.min
                              const mulai = clampDateTimeLocal(e.target.value, min, createPeriodBounds.endsAt)
                              setEditForm((p) => ({
                                ...p,
                                mulai,
                                deadline: clampDateTimeLocal(p.deadline, mulai, createPeriodBounds.endsAt)
                              }))
                            }}
                            min={isPastDateTimeLocal(editForm.originalMulai) ? createPeriodBounds.startsAt || undefined : createPeriodBounds.min}
                            max={createPeriodBounds.endsAt || undefined}
                          />
                        </div>

                        <div>
                          <label htmlFor="edit-tugas-deadline" className="block text-sm font-semibold text-slate-700 mb-2">Deadline</label>
                          <input
                            id="edit-tugas-deadline"
                            name="edit_deadline"
                            type="datetime-local"
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                            value={editForm.deadline}
                            onChange={(e) => setEditForm((p) => ({
                              ...p,
                              deadline: clampDateTimeLocal(
                                e.target.value,
                                isPastDateTimeLocal(editForm.originalDeadline)
                                  ? p.mulai || createPeriodBounds.startsAt
                                  : maxDateTimeLocal(createPeriodBounds.min, p.mulai || createPeriodBounds.min),
                                createPeriodBounds.endsAt
                              )
                            }))}
                            min={isPastDateTimeLocal(editForm.originalDeadline) ? editForm.mulai || createPeriodBounds.startsAt || undefined : maxDateTimeLocal(createPeriodBounds.min, editForm.mulai || createPeriodBounds.min)}
                            max={createPeriodBounds.endsAt || undefined}
                          />
                        </div>

                        <div className="md:col-span-3">
                          <label htmlFor="edit-tugas-keterangan" className="block text-sm font-semibold text-slate-700 mb-2">Keterangan</label>
                          <textarea
                            id="edit-tugas-keterangan"
                            name="edit_keterangan"
                            rows="7"
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm resize-none"
                            value={editForm.keterangan}
                            onChange={(e) => setEditForm((p) => ({ ...p, keterangan: e.target.value }))}
                            maxLength={1000}
                          />
                        </div>

                        <div className="md:col-span-3">
                          <label htmlFor="edit-tugas-link" className="block text-sm font-semibold text-slate-700 mb-2">Link Referensi (opsional)</label>
                          <input
                            id="edit-tugas-link"
                            name="edit_link"
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                            value={editForm.link || ''}
                            onChange={(e) => setEditForm((p) => ({ ...p, link: e.target.value }))}
                            placeholder="contoh: drive.google.com/... / youtube.com/... / website"
                          />
                          <p className="text-[11px] text-slate-500 mt-1">
                            Link manual disimpan di database/VPS, bukan di Google Drive sekolah.
                          </p>
                        </div>
                      </div>

                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div>
                            <div className="font-bold text-slate-800">File Lampiran</div>
                            <div className="text-xs text-slate-500">Lampiran tersimpan aman di storage sekolah.</div>
                          </div>
                          {editForm.file_url && (
                            <div className="flex items-center gap-2">
                              {renderFileButton(editForm.file_url, 'Preview', editExistingFileSize || uploadedFileSizeEdit)}
                              <button
                                type="button"
                                onClick={() => { void removeEditAttachment() }}
                                className="px-4 py-2 rounded-2xl bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors"
                              >
                                Hapus
                              </button>
                            </div>
                          )}
                        </div>

                        {isUploadingFile ? (
                          <UploadProgressTrain
                            label={compressionProgress || 'Mengupload file...'}
                            detail={uploadDetailForProvider(uploadProvider, 'Lampiran tugas sedang diproses dan dikirim.')}
                            progress={uploadPercent}
                            tone={uploadToneForProvider(uploadProvider)}
                          />
                        ) : (
                          <FileDropzone
                            id="edit-tugas-lampiran"
                            name="edit_lampiran"
                            onFiles={handleEditFileUpload}
                            accept={ASSIGNMENT_FILE_ACCEPT}
                            label={editForm.file_url ? 'Ganti file lampiran (opsional)' : 'Seret file lampiran baru ke sini atau klik untuk memilih'}
                          />
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-4">
                        {selectedTugas.keterangan ? (
                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <div className="mb-2 text-sm font-bold text-slate-900">Instruksi</div>
                            <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                              {selectedTugas.keterangan}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-500">
                            <div className="font-semibold">Tidak ada keterangan.</div>
                          </div>
                        )}

                        {isLoadingDetail ? (
                          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
                            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                            <div className="text-slate-600 font-semibold">Memuat detail...</div>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {renderTabelSiswa(siswaDikerjakan, 'dikerjakan')}
                            {renderTabelSiswa(siswaDinilai, 'dinilai')}
                            {renderTabelSiswa(siswaBelum, 'belum')}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {studentCommentPreview && (
          <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/45 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
                    <MessageSquare className="h-4 w-4 text-amber-600" />
                    Komentar Siswa
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {studentCommentPreview.siswa}
                    {studentCommentPreview.kelas ? ` • ${studentCommentPreview.kelas}` : ''}
                    {studentCommentPreview.waktu ? ` • ${formatDateTime(studentCommentPreview.waktu)}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setStudentCommentPreview(null)}
                  className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  aria-label="Tutup komentar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="px-5 py-4">
                <div className="whitespace-pre-wrap rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-slate-800">
                  {studentCommentPreview.komentar}
                </div>
              </div>
              <div className="flex justify-end border-t border-slate-100 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setStudentCommentPreview(null)}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
                >
                  Tutup
                </button>
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
