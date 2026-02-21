// src/pages/guru/TugasGuru.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  supabase,
  ASSIGNMENT_BUCKET,
  PROFILE_BUCKET,
  extractObjectPath,
  getSignedUrlForValue,
  removeStorageObject
} from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import FileDropzone from '../../components/FileDropzone'
import FilePreviewModal from '../../components/FilePreviewModal'
import { parseSupabaseError } from '../../utils/supabaseError'

/* =========================
   Constants & Helpers
========================= */
const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
]

const FILE_SIZE_LIMITS = {
  IMAGE: 100 * 1024,
  PDF: 2 * 1024 * 1024,
  DOCUMENT: 2 * 1024 * 1024,
  PRESENTATION: 3 * 1024 * 1024
}

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
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.oasis.opendocument.presentation': ['.odp']
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

const NEAR_DEADLINE_HOURS = 24

const toDatetimeLocalValue = (isoString) => {
  if (!isoString) return getNowDateTimeLocal()
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return getNowDateTimeLocal()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime())

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

const validateTimelineInput = (mulai, deadline) => {
  const now = new Date()
  now.setSeconds(0, 0)
  const mulaiDate = mulai ? new Date(mulai) : null
  const deadlineDate = deadline ? new Date(deadline) : null

  if (!mulai || !isValidDate(mulaiDate)) return 'Waktu mulai wajib diisi dan valid'
  if (!deadline || !isValidDate(deadlineDate)) return 'Deadline wajib diisi dan valid'
  if (mulaiDate < now) return 'Waktu mulai tidak boleh di masa lalu'
  if (deadlineDate < now) return 'Deadline tidak boleh di masa lalu'
  if (deadlineDate <= mulaiDate) return 'Deadline harus setelah waktu mulai'
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
    'Tipe file tidak didukung. Gunakan gambar (JPG/PNG), PDF/Dokumen, atau PPT.'
  )
}

/* =========================
   Storage Helpers (FIXED)
   - Preview selalu buat signed URL baru
   - Support input path maupun URL (public/signed lama)
========================= */
const normalizeAssignmentKey = (urlOrPath) => extractObjectPath(ASSIGNMENT_BUCKET, urlOrPath || '')

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
  const { pushToast, setLoading } = useUIStore()

  /* ---------- State ---------- */
  const [jadwalAll, setJadwalAll] = useState([])
  const [kelasList, setKelasList] = useState([])

  // Create form
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
  const [compressionProgress, setCompressionProgress] = useState(null)

  // History filter
  const [listTugas, setListTugas] = useState([])
  const [selectedKelasFilter, setSelectedKelasFilter] = useState('')
  const [mapelListFilter, setMapelListFilter] = useState([])
  const [selectedSubject, setSelectedSubject] = useState('')
  const [timeRange, setTimeRange] = useState('week') // week | all | custom_months
  const [filterStatus, setFilterStatus] = useState('all') // all | active | expired
  const [selectedMonths, setSelectedMonths] = useState([])

  // Detail
  const [selectedTugas, setSelectedTugas] = useState(null)
  const [siswaDiKelas, setSiswaDiKelas] = useState([])
  const [jawabanTugas, setJawabanTugas] = useState([])
  const [nilaiInput, setNilaiInput] = useState({})
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)

  // Edit
  const [isEditingTugas, setIsEditingTugas] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [uploadedFileSizeEdit, setUploadedFileSizeEdit] = useState('')
  const [editExistingFileSize, setEditExistingFileSize] = useState('')

  // Sidebar: tasks needing grading
  const [tugasPerluDinilai, setTugasPerluDinilai] = useState([])
  const [isLoadingTugasPerluDinilai, setIsLoadingTugasPerluDinilai] = useState(false)

  // Preview
  const [previewFile, setPreviewFile] = useState(null)
  const detailLoadIdRef = useRef(0)

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

  /* ========== Reset months when timeRange changes ========== */
  useEffect(() => {
    if (timeRange !== 'custom_months') setSelectedMonths([])
  }, [timeRange])

  /* =========================
     1) Load kelas list (master)
========================= */
  useEffect(() => {
    const loadKelasData = async () => {
      try {
        const { data, error } = await supabase.from('kelas').select('*').order('grade').order('suffix')
        if (error) throw error
        setKelasList(data || [])
      } catch (error) {
        console.error('Error loading kelas data:', error)
      }
    }
    loadKelasData()
  }, [])

  /* =========================
     2) Load jadwal guru (kelas+mapel yang diampu)
========================= */
  useEffect(() => {
    const loadJadwal = async () => {
      if (!user?.id) return
      try {
        const { data, error } = await supabase.from('jadwal').select('*').eq('guru_id', user.id)
        if (error) throw error
        setJadwalAll(data || [])
      } catch (error) {
        console.error('Error loading jadwal:', error)
        pushToast('error', 'Gagal memuat jadwal mengajar')
      }
    }
    loadJadwal()
  }, [user?.id, pushToast])

  /* =========================
     3) Mapel list untuk form create
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
     4) Mapel list untuk filter history
========================= */
  useEffect(() => {
    if (selectedKelasFilter && jadwalAll.length) {
      const mapels = jadwalAll
        .filter((j) => j.kelas_id === selectedKelasFilter)
        .map((j) => j.mapel)
        .filter((v, i, self) => self.indexOf(v) === i)
        .sort()

      setMapelListFilter(mapels)
      if (mapels.length > 0 && !mapels.includes(selectedSubject)) setSelectedSubject(mapels[0])
      if (mapels.length === 0) setSelectedSubject('')
    } else {
      setMapelListFilter([])
      setSelectedSubject('')
    }
  }, [selectedKelasFilter, jadwalAll, selectedSubject])

  /* =========================
     5) Load list tugas (history) + stats
========================= */
  const loadTugas = useCallback(async () => {
    if (!user?.id) return
    try {
      setLoading(true)
      const now = new Date()

      let query = supabase.from('tugas').select('*').eq('created_by', user.id)

      if (selectedKelasFilter) query = query.eq('kelas', selectedKelasFilter)
      if (selectedSubject) query = query.eq('mapel', selectedSubject)

      if (filterStatus === 'active') query = query.gte('deadline', now.toISOString())
      if (filterStatus === 'expired') query = query.lt('deadline', now.toISOString())

      if (timeRange === 'week') {
        const weekAgo = new Date(now)
        weekAgo.setDate(now.getDate() - 7)
        query = query.gte('created_at', weekAgo.toISOString())
      } else {
        const yearAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)
        query = query.gte('created_at', yearAgo.toISOString())
      }

      query = query.order('created_at', { ascending: false })
      const { data: tugasRaw, error } = await query
      if (error) throw error

      let tugasData = tugasRaw || []

      if (timeRange === 'custom_months') {
        const yearAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)
        // jika belum pilih bulan, fallback 12 bulan terakhir
        if (selectedMonths.length === 0) {
          tugasData = tugasData.filter((t) => t.created_at && new Date(t.created_at) >= yearAgo)
        } else {
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

      if (tugasData.length === 0) {
        setListTugas([])
        return
      }

      const tugasIds = tugasData.map((t) => t.id)
      const uniqueKelas = [...new Set(tugasData.map((t) => t.kelas).filter(Boolean))]
      const uniqueKelasVariants = Array.from(new Set(uniqueKelas.flatMap((k) => buildKelasVariants(k))))

      const jawabanPromise =
        tugasIds.length > 0
          ? supabase.from('tugas_jawaban').select('tugas_id, user_id, nilai').in('tugas_id', tugasIds)
          : Promise.resolve({ data: [], error: null })

      const siswaPromise =
        uniqueKelasVariants.length > 0
          ? supabase
              .from('profiles')
              .select('id, kelas')
              .eq('role', 'siswa')
              .in('kelas', uniqueKelasVariants)
          : Promise.resolve({ data: [], error: null })

      const [
        { data: jawabanData, error: jawErr },
        { data: siswaData, error: siswaErr }
      ] = await Promise.all([jawabanPromise, siswaPromise])

      if (jawErr) console.error('Error fetching stats jawaban tugas:', jawErr)
      if (siswaErr) console.error('Error fetching students for stats:', siswaErr)

      const jawabanArr = jawabanData || []
      const siswaArr = siswaData || []

      const formatted = tugasData.map((tugas) => {
        const kelasKey = normalizeKelasKey(tugas.kelas)
        const siswaKelas = siswaArr.filter((s) => normalizeKelasKey(s.kelas) === kelasKey)
        const totalSiswa = siswaKelas.length

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

      setListTugas(formatted)
    } catch (error) {
      console.error('Error loading tugas:', error)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal memuat data tugas: ${parsed.message}`)
    } finally {
      setLoading(false)
    }
  }, [
    user?.id,
    selectedKelasFilter,
    selectedSubject,
    timeRange,
    filterStatus,
    selectedMonths,
    setLoading,
    pushToast
  ])

  useEffect(() => {
    if (user?.id) loadTugas()
  }, [user?.id, loadTugas])

  /* =========================
     6) Load "tugas perlu dinilai" (sidebar)
========================= */
  const loadTugasPerluDinilai = useCallback(async () => {
    if (!user?.id) return
    try {
      setIsLoadingTugasPerluDinilai(true)

      const { data: tugasData, error: tugasError } = await supabase
        .from('tugas')
        .select('*')
        .eq('created_by', user.id)

      if (tugasError) throw tugasError
      if (!tugasData || tugasData.length === 0) {
        setTugasPerluDinilai([])
        return
      }

      const tugasIds = tugasData.map((t) => t.id)
      const { data: jawabanData, error: jawabanError } = await supabase
        .from('tugas_jawaban')
        .select('id, tugas_id, user_id, nilai')
        .in('tugas_id', tugasIds)
        .eq('nilai', null)

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
  }, [user?.id])

  useEffect(() => {
    if (user?.id) loadTugasPerluDinilai()
  }, [user?.id, loadTugasPerluDinilai])

  /* =========================
     7) Detail Tugas (modal)
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
          .select('id, tugas_id, user_id, file_url, link_url, nilai, status, waktu_submit, profiles(nama, photo_url)')
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

    try {
      setIsUploadingFile(true)
      setCompressionProgress('Mengkompresi file...')

      const compressed = await compressFileBeforeUpload(file)

      const safeName = sanitizeFileName(compressed.name)
      const filePath = `tugas_lampiran/${user.id}/${Date.now()}-${safeName}`

      setCompressionProgress('Mengupload file...')

      const { error: uploadError } = await supabase.storage
        .from(ASSIGNMENT_BUCKET)
        .upload(filePath, compressed, { upsert: false, cacheControl: '3600' })

      if (uploadError) {
        // RLS storage paling sering muncul di sini
        throw new Error(uploadError.message || 'Upload ditolak oleh policy storage')
      }

      // Hapus file lama jika ada (hanya file milik guru sendiri)
      const currentFile = mode === 'edit' ? editForm?.file_url : form.file_url
      if (currentFile) {
        try {
          await deleteTeacherAttachment(currentFile, user.id)
        } catch (e) {
          console.warn('Gagal menghapus file lama:', e)
        }
      }

      const sizeLabel = formatFileSize(compressed.size)
      setCompressionProgress(null)

      if (mode === 'edit') {
        setEditForm((prev) => ({ ...prev, file_url: filePath }))
        setUploadedFileSizeEdit(sizeLabel)
        setEditExistingFileSize(sizeLabel)
      } else {
        setForm((prev) => ({ ...prev, file_url: filePath }))
        setUploadedFileSizeCreate(sizeLabel)
      }

      pushToast('success', `File berhasil diupload (${sizeLabel})`)
    } catch (error) {
      console.error('Upload error:', error)
      setCompressionProgress(null)
      const parsed = parseSupabaseError(error)
      // bantu diagnosa biar cepat
      if (parsed.code === 'rls_denied' || parsed.code === 'storage_policy_recursion') {
        pushToast('error', `Upload ditolak oleh policy storage: ${parsed.message}`)
      } else {
        pushToast('error', `Gagal mengupload file: ${parsed.message}`)
      }
    } finally {
      setIsUploadingFile(false)
    }
  }

  const handleEditFileUpload = async (files) => handleFileUpload(files, 'edit')

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
    if (timelineError) {
      pushToast('error', timelineError)
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
        created_by: user.id
      }

      const { error } = await supabase.from('tugas').insert(payload)
      if (error) throw error

      pushToast('success', 'Tugas berhasil ditambahkan')
      const nowLocal = getNowDateTimeLocal()
      setForm({ judul: '', keterangan: '', link: '', mulai: nowLocal, deadline: nowLocal, file_url: '' })
      setUploadedFileSizeCreate('')

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

    setEditForm({
      id: selectedTugas.id,
      kelas: selectedTugas.kelas,
      mapel: selectedTugas.mapel,
      judul: selectedTugas.judul,
      keterangan: selectedTugas.keterangan || '',
      link: selectedTugas.link || '',
      mulai: toDatetimeLocalValue(selectedTugas.mulai || selectedTugas.created_at),
      deadline: toDatetimeLocalValue(selectedTugas.deadline),
      file_url: selectedTugas.file_url || '',
      created_by: selectedTugas.created_by,
      hasGradedSubmissions: Boolean(selectedTugas.hasGradedSubmissions || (selectedTugas.stats?.sudah || 0) > 0)
    })
    setIsEditingTugas(true)
    setUploadedFileSizeEdit('')
    setEditExistingFileSize('')
  }

  const simpanEditTugas = async () => {
    if (!editForm || !user?.id) return

    if (editForm.created_by !== user.id) {
      pushToast('error', 'Anda tidak memiliki akses untuk mengedit tugas ini')
      setIsEditingTugas(false)
      setEditForm(null)
      return
    }

    if (!validateKelasAccess(myKelasList, editForm.kelas)) {
      pushToast('error', 'Anda tidak memiliki akses ke kelas ini')
      return
    }

    const timelineError = validateTimelineInput(editForm.mulai, editForm.deadline)
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
        mulai: new Date(editForm.mulai).toISOString(),
        deadline: new Date(editForm.deadline).toISOString(),
        file_url: editForm.file_url,
        updated_at: new Date().toISOString()
      }

      const { error } = await supabase
        .from('tugas')
        .update(payload)
        .eq('id', editForm.id)
        .eq('created_by', user.id)

      if (error) throw error

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
          <div className="overflow-x-auto">
            <table className="w-full min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-2 font-semibold text-slate-700">Siswa</th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700">Jawaban</th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700">Waktu</th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700">
                    {type === 'belum' ? 'Keterangan' : 'Nilai'}
                  </th>
                  {type !== 'belum' && (
                    <th className="text-left py-3 px-2 font-semibold text-slate-700">Aksi</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {siswaList.map((siswa) => {
                  const jawaban = siswa.jawaban
                  return (
                    <tr key={siswa.id} className="border-b border-slate-100 hover:bg-white/60 transition-colors">
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar src={siswa.photo_url} name={siswa.nama} />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-800 truncate">{siswa.nama}</div>
                            <div className="text-xs text-slate-500 truncate">{siswa.kelas}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-2">
                        {type === 'belum' ? (
                          <span className="text-xs text-slate-500">-</span>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {jawaban?.file_url && (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const signed = await createSignedUrlForAssignment(jawaban.file_url, 60 * 30)
                                    setPreviewFile(signed)
                                  } catch (e) {
                                    console.error(e)
                                    const parsed = parseSupabaseError(e)
                                    pushToast('error', `Gagal membuka file jawaban: ${parsed.message}`)
                                  }
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs hover:bg-blue-200 transition-colors"
                              >
                                📎 File
                              </button>
                            )}
                            {jawaban?.link_url && (
                              <button
                                type="button"
                                onClick={() => setPreviewFile(jawaban.link_url)}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 rounded-lg text-xs hover:bg-purple-200 transition-colors"
                              >
                                🔗 Link
                              </button>
                            )}
                            {!jawaban?.file_url && !jawaban?.link_url && (
                              <span className="text-xs text-slate-500">-</span>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-2">
                        {jawaban?.waktu_submit ? (
                          <span className="text-xs text-slate-600">{formatDateTime(jawaban.waktu_submit)}</span>
                        ) : (
                          <span className="text-xs text-slate-500">-</span>
                        )}
                      </td>

                      <td className="py-3 px-2">
                        {type === 'belum' ? (
                          <span className="text-xs text-slate-500">Belum mengumpulkan</span>
                        ) : (
                          <span
                            className={`text-xs font-semibold px-2 py-1 rounded-full ${
                              jawaban?.nilai != null
                                ? 'bg-green-100 text-green-700'
                                : 'bg-yellow-100 text-yellow-700'
                            }`}
                          >
                            {jawaban?.nilai != null ? `✅ ${jawaban.nilai}` : '📝 Menunggu'}
                          </span>
                        )}
                      </td>

                      {type !== 'belum' && (
                        <td className="py-3 px-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              inputMode="numeric"
                              className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
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
                              className="px-3 py-1 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation()
                                simpanNilai(siswa.id)
                              }}
                              type="button"
                            >
                              💾 Simpan
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  const monthOptions = useMemo(() => buildLast12Months(), [])

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
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                <span className="text-2xl text-white">📚</span>
              </div>
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-slate-800 mb-2">Kelola Tugas</h1>
                <p className="text-slate-600 text-base">Buat, atur, dan nilai tugas untuk siswa Anda</p>
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

        {/* FORM BUAT TUGAS */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6">
          <h3 className="text-xl font-bold text-slate-800 mb-5 flex items-center gap-3">
            <div className="w-9 h-9 bg-green-500 rounded-xl flex items-center justify-center shadow">
              <span className="text-white text-sm">➕</span>
            </div>
            <span>Buat Tugas Baru</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Kelas</label>
              <select
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
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
              <p className="text-[11px] text-slate-500 mt-1">Hanya kelas yang Anda ampu yang tampil.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Mata Pelajaran</label>
              <select
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-50 text-sm"
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

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Judul Tugas</label>
              <input
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                value={form.judul}
                onChange={(e) => setForm((prev) => ({ ...prev, judul: e.target.value }))}
                placeholder="Judul tugas..."
                maxLength={200}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Mulai</label>
              <input
                type="datetime-local"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                value={form.mulai}
                onChange={(e) => setForm((prev) => ({ ...prev, mulai: e.target.value }))}
                min={getNowDateTimeLocal()}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Deadline</label>
              <input
                type="datetime-local"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                value={form.deadline}
                onChange={(e) => setForm((prev) => ({ ...prev, deadline: e.target.value }))}
                min={maxDateTimeLocal(getNowDateTimeLocal(), form.mulai || getNowDateTimeLocal())}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Keterangan Tugas</label>
              <textarea
                rows="7"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white resize-none text-sm"
                value={form.keterangan}
                onChange={(e) => setForm((prev) => ({ ...prev, keterangan: e.target.value }))}
                placeholder="Tambahkan instruksi pengerjaan tugas..."
                maxLength={1000}
              />

              <div className="mt-4">
                <label className="block text-sm font-semibold text-slate-700 mb-2">Link Referensi (opsional)</label>
                <input
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                  value={form.link}
                  onChange={(e) => setForm((prev) => ({ ...prev, link: e.target.value }))}
                  placeholder="contoh: drive.google.com/... / youtube.com/... / website"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Link akan bisa dipreview overlay (Google Drive / YouTube / Website).
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">File Lampiran (opsional)</label>

              {compressionProgress && (
                <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <div className="flex items-center gap-2 text-blue-700 text-sm">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    {compressionProgress}
                  </div>
                </div>
              )}

              {isUploadingFile ? (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-slate-600 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <span>Mengupload file...</span>
                  </div>
                </div>
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
                  onFiles={(files) => handleFileUpload(files, 'create')}
                  accept={ASSIGNMENT_FILE_ACCEPT}
                  label="Seret file lampiran ke sini atau klik untuk memilih"
                />
              )}

              <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-xs font-semibold text-slate-700 mb-2">📋 Batas Ukuran File:</p>
                <ul className="text-xs text-slate-600 space-y-1">
                  <li>🖼️ Gambar: maks 100KB (otomatis dikompresi)</li>
                  <li>📄 PDF/Dokumen: maks 2MB</li>
                  <li>📊 PPT: maks 3MB</li>
                </ul>
              </div>
            </div>
          </div>

          <button
            className="w-full mt-6 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-4 px-6 rounded-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 text-base shadow-lg"
            onClick={tambahTugas}
            disabled={!kelas || !selectedMapel || !form.judul || !form.mulai || !form.deadline}
            type="button"
          >
            <span>💾</span>
            <span>Simpan Tugas Baru</span>
          </button>
        </div>

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
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Kelas</label>
                  <select
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
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

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Mapel</label>
                  <select
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm disabled:opacity-50"
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

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Status Deadline</label>
                  <select
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                  >
                    <option value="all">Semua</option>
                    <option value="active">Aktif</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Rentang Waktu</label>
                  <select
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value)}
                  >
                    <option value="week">7 hari terakhir</option>
                    <option value="all">12 bulan terakhir</option>
                    <option value="custom_months">Pilih bulan</option>
                  </select>
                </div>

                {timeRange === 'custom_months' && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="text-xs font-semibold text-slate-700 mb-2">Pilih bulan (multi)</div>
                    <div className="space-y-2 max-h-56 overflow-auto pr-1">
                      {monthOptions.map((m) => {
                        const checked = selectedMonths.includes(m.value)
                        return (
                          <label key={m.value} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
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
                    setTimeRange('week')
                    setSelectedMonths([])
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
              </div>

              {listTugas.length === 0 ? (
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
              onClick={() => {
                setSelectedTugas(null)
                setIsEditingTugas(false)
                setEditForm(null)
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSelectedTugas(null)
                  setIsEditingTugas(false)
                  setEditForm(null)
                }
              }}
            />

            <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-6">
              <div className="w-full max-w-6xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
                {/* Header modal */}
                <div className="p-5 sm:p-6 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50/40">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-bold">
                          📌
                        </div>
                        <div className="min-w-0">
                          <div className="text-xl sm:text-2xl font-extrabold text-slate-800 truncate">
                            {selectedTugas.judul}
                          </div>
                          <div className="text-sm text-slate-600 mt-1">
                            {formatKelasDisplay(selectedTugas.kelas)} • {selectedTugas.mapel}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 font-semibold">
                          Dibuat: {formatDateTime(selectedTugas.created_at)}
                        </span>
                        <span
                          className={`px-3 py-1 rounded-full font-semibold ${
                            selectedTugas.isBeforeStart ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          Mulai: {formatDateTime(selectedTugas.mulai || selectedTugas.created_at)}
                        </span>
                        <span
                          className={`px-3 py-1 rounded-full font-semibold ${
                            selectedTugas.isExpired
                              ? 'bg-red-100 text-red-700'
                              : selectedTugas.isNearDeadline
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-green-100 text-green-700'
                          }`}
                        >
                          Deadline: {formatDateTime(selectedTugas.deadline)}
                        </span>
                        {selectedTugas.file_url && (
                          <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 font-semibold">
                            Ada Lampiran
                          </span>
                        )}
                        {selectedTugas.link && (
                          <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-700 font-semibold">
                            Ada Link
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 justify-end">
                      {selectedTugas.file_url && (
                        <button
                          type="button"
                          onClick={() => openPreviewAny(selectedTugas.file_url, 'Gagal membuka lampiran tugas')}
                          className="px-4 py-2 rounded-2xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
                        >
                          📎 Lampiran
                        </button>
                      )}
                      {selectedTugas.link && (
                        <button
                          type="button"
                          onClick={() => openPreviewAny(selectedTugas.link, 'Gagal membuka link referensi')}
                          className="px-4 py-2 rounded-2xl bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-colors"
                        >
                          🔗 Link Referensi
                        </button>
                      )}

                      {!isEditingTugas ? (
                        <>
                          <button
                            type="button"
                            onClick={openEditTugas}
                            className="px-4 py-2 rounded-2xl bg-slate-800 text-white font-semibold hover:bg-slate-900 transition-colors"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => hapusTugas(selectedTugas.id, selectedTugas.file_url)}
                            disabled={selectedHasGradedSubmission}
                            className="px-4 py-2 rounded-2xl bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {selectedHasGradedSubmission ? '🔒 Tidak Bisa Hapus' : '🗑️ Hapus'}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={simpanEditTugas}
                            className="px-4 py-2 rounded-2xl bg-green-600 text-white font-semibold hover:bg-green-700 transition-colors"
                          >
                            💾 Simpan Perubahan
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setIsEditingTugas(false)
                              setEditForm(null)
                            }}
                            className="px-4 py-2 rounded-2xl bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 transition-colors"
                          >
                            ✖️ Batal
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTugas(null)
                          setIsEditingTugas(false)
                          setEditForm(null)
                        }}
                        className="px-4 py-2 rounded-2xl bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 transition-colors"
                      >
                        ❌ Tutup
                      </button>
                    </div>
                  </div>
                </div>

                {/* Body modal */}
                <div className="p-5 sm:p-6 max-h-[75vh] overflow-auto">
                  {/* Edit Form */}
                  {isEditingTugas && editForm ? (
                    <div className="space-y-5">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">Judul</label>
                          <input
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                            value={editForm.judul}
                            onChange={(e) => setEditForm((p) => ({ ...p, judul: e.target.value }))}
                            maxLength={200}
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">Mulai</label>
                          <input
                            type="datetime-local"
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                            value={editForm.mulai}
                            onChange={(e) => setEditForm((p) => ({ ...p, mulai: e.target.value }))}
                            min={getNowDateTimeLocal()}
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">Deadline</label>
                          <input
                            type="datetime-local"
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                            value={editForm.deadline}
                            onChange={(e) => setEditForm((p) => ({ ...p, deadline: e.target.value }))}
                            min={maxDateTimeLocal(getNowDateTimeLocal(), editForm.mulai || getNowDateTimeLocal())}
                          />
                        </div>

                        <div className="md:col-span-3">
                          <label className="block text-sm font-semibold text-slate-700 mb-2">Keterangan</label>
                          <textarea
                            rows="7"
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm resize-none"
                            value={editForm.keterangan}
                            onChange={(e) => setEditForm((p) => ({ ...p, keterangan: e.target.value }))}
                            maxLength={1000}
                          />
                        </div>

                        <div className="md:col-span-3">
                          <label className="block text-sm font-semibold text-slate-700 mb-2">Link Referensi (opsional)</label>
                          <input
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                            value={editForm.link || ''}
                            onChange={(e) => setEditForm((p) => ({ ...p, link: e.target.value }))}
                            placeholder="contoh: drive.google.com/... / youtube.com/... / website"
                          />
                        </div>
                      </div>

                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div>
                            <div className="font-bold text-slate-800">File Lampiran</div>
                            <div className="text-xs text-slate-500">File disimpan di folder guru (anti-IDOR).</div>
                          </div>
                          {editForm.file_url && (
                            <div className="flex items-center gap-2">
                              {renderFileButton(editForm.file_url, 'Preview', editExistingFileSize || uploadedFileSizeEdit)}
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await deleteTeacherAttachment(editForm.file_url, user.id)
                                    setEditForm((p) => ({ ...p, file_url: '' }))
                                    setUploadedFileSizeEdit('')
                                    setEditExistingFileSize('')
                                    pushToast('success', 'File berhasil dihapus')
                                  } catch (e) {
                                    pushToast('error', `Gagal menghapus file: ${e?.message || 'Unknown error'}`)
                                  }
                                }}
                                className="px-4 py-2 rounded-2xl bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors"
                              >
                                Hapus
                              </button>
                            </div>
                          )}
                        </div>

                        {compressionProgress && (
                          <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                            <div className="flex items-center gap-2 text-blue-700 text-sm">
                              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                              {compressionProgress}
                            </div>
                          </div>
                        )}

                        <FileDropzone
                          onFiles={handleEditFileUpload}
                          accept={ASSIGNMENT_FILE_ACCEPT}
                          label={editForm.file_url ? 'Ganti file lampiran (opsional)' : 'Seret file lampiran baru ke sini atau klik untuk memilih'}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <div className="lg:col-span-2 space-y-4">
                          {selectedTugas.keterangan ? (
                            <div className="bg-white border border-slate-200 rounded-2xl p-4">
                              <div className="text-sm font-bold text-slate-800 mb-2">🧾 Instruksi</div>
                              <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                {selectedTugas.keterangan}
                              </div>
                            </div>
                          ) : (
                            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-slate-500">
                              <div className="font-semibold">Tidak ada keterangan.</div>
                            </div>
                          )}

                          {selectedTugas.link && (
                            <div className="bg-white border border-slate-200 rounded-2xl p-4">
                              <div className="text-sm font-bold text-slate-800 mb-2">🔗 Link Referensi</div>
                              <div className="text-xs text-slate-500 break-all mb-3">{selectedTugas.link}</div>
                              <button
                                type="button"
                                onClick={() => openPreviewAny(selectedTugas.link, 'Gagal membuka link referensi')}
                                className="px-4 py-2 rounded-xl bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 transition-colors"
                              >
                                👁️ Preview Link
                              </button>
                            </div>
                          )}

                          {isLoadingDetail ? (
                            <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
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

                        <div className="space-y-4">
                          <div className="bg-white border border-slate-200 rounded-2xl p-4">
                            <div className="text-sm font-bold text-slate-800 mb-3">📊 Ringkasan</div>

                            <div className="grid grid-cols-2 gap-3">
                              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                                <div className="text-xs text-slate-500">Total Siswa</div>
                                <div className="text-xl font-extrabold text-slate-800">{siswaDiKelas.length}</div>
                              </div>
                              <div className="p-3 rounded-2xl bg-blue-50 border border-blue-200">
                                <div className="text-xs text-blue-700">Mengumpulkan</div>
                                <div className="text-xl font-extrabold text-blue-800">{jawabanTugas.length}</div>
                              </div>
                              <div className="p-3 rounded-2xl bg-yellow-50 border border-yellow-200">
                                <div className="text-xs text-yellow-700">Menunggu Nilai</div>
                                <div className="text-xl font-extrabold text-yellow-800">{siswaDikerjakan.length}</div>
                              </div>
                              <div className="p-3 rounded-2xl bg-green-50 border border-green-200">
                                <div className="text-xs text-green-700">Sudah Dinilai</div>
                                <div className="text-xl font-extrabold text-green-800">{siswaDinilai.length}</div>
                              </div>
                            </div>

                            <div className="mt-4 text-xs text-slate-500">
                              Nilai tersimpan akan otomatis ter-update di kartu riwayat dan sidebar.
                            </div>
                          </div>

                          {selectedTugas.file_url && (
                            <div className="bg-white border border-slate-200 rounded-2xl p-4">
                              <div className="text-sm font-bold text-slate-800 mb-2">📎 Lampiran</div>
                              <div className="flex flex-wrap gap-2">
                                {renderFileButton(selectedTugas.file_url, 'Preview Lampiran')}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-2">
                                Preview butuh policy storage SELECT + signed URL.
                              </div>
                            </div>
                          )}

                          {selectedTugas.link && (
                            <div className="bg-white border border-slate-200 rounded-2xl p-4">
                              <div className="text-sm font-bold text-slate-800 mb-2">🔗 Link Referensi</div>
                              <button
                                type="button"
                                onClick={() => openPreviewAny(selectedTugas.link, 'Gagal membuka link referensi')}
                                className="w-full px-4 py-3 rounded-2xl bg-purple-600 text-white font-bold hover:bg-purple-700 transition-colors"
                              >
                                👁️ Preview Link
                              </button>
                            </div>
                          )}

                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Preview Modal */}
        {previewFile && <FilePreviewModal fileUrl={previewFile} onClose={() => setPreviewFile(null)} />}
      </div>
    </div>
  )
}
