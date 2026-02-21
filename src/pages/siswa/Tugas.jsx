// src/pages/siswa/TugasSiswa.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
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

const looksLikeDomainUrl = (v = '') => /^[a-z0-9-]+(\.[a-z0-9-]+)+(?::\d+)?(\/|$)/i.test(String(v || '').trim())

const hasUsableValue = (value = '') => {
  const raw = String(value || '').trim()
  if (!raw) return false
  const normalized = raw.toLowerCase()
  return !['null', 'undefined', '-', 'n/a'].includes(normalized)
}

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
    'Tipe file tidak didukung. Gunakan gambar (JPG/PNG), PDF/Dokumen, atau PPT.'
  )
}

/* =========================
   Storage Helpers
========================= */
const extractObjectKeyFromAny = (value) => extractObjectPath(ASSIGNMENT_BUCKET, value || '')

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
  const { pushToast, setLoading } = useUIStore()

  /* ---------- State ---------- */
  const [tugasList, setTugasList] = useState([])
  const [selectedKelas, setSelectedKelas] = useState('')
  const [selectedMapel, setSelectedMapel] = useState('')
  const [mapelOptions, setMapelOptions] = useState([])

  const [timeRange, setTimeRange] = useState('week') // week | all | custom_months
  const [selectedMonths, setSelectedMonths] = useState([])
  const [statusFilter, setStatusFilter] = useState('all') // all | belum | menunggu | dinilai
  const [searchTerm, setSearchTerm] = useState('')

  const [selectedTugas, setSelectedTugas] = useState(null)
  const [detail, setDetail] = useState(null)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)

  const [jawabanFileKey, setJawabanFileKey] = useState('')
  const [jawabanFileSize, setJawabanFileSize] = useState('')
  const [jawabanLink, setJawabanLink] = useState('')

  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)

  const [previewFile, setPreviewFile] = useState(null)

  const searchDebounceRef = useRef(null)

  /* ---------- Derived ---------- */
  const monthOptions = useMemo(() => buildLast12Months(), [])

  const kelasSiswa = useMemo(() => profile?.kelas || profile?.kelas_id || '', [profile])

  useEffect(() => {
    if (kelasSiswa && !selectedKelas) setSelectedKelas(kelasSiswa)
  }, [kelasSiswa, selectedKelas])

  /* =========================
     Load Tugas List
     ANTI-IDOR:
     - siswa hanya baca tugas berdasarkan kelasnya sendiri
     - siswa hanya baca jawaban miliknya sendiri pada tugas_jawaban (RLS harus enforce)
========================= */
  const loadTugasList = useCallback(async () => {
    if (!user?.id) return
    const kelas = selectedKelas || kelasSiswa
    if (!kelas) return

    try {
      setLoading(true)
      const now = new Date()

      // tugas untuk kelas siswa
      let query = supabase.from('tugas').select('*').eq('kelas', kelas)

      if (selectedMapel) query = query.eq('mapel', selectedMapel)

      if (timeRange === 'week') {
        const weekAgo = new Date(now)
        weekAgo.setDate(now.getDate() - 7)
        query = query.gte('created_at', weekAgo.toISOString())
      } else if (timeRange === 'all') {
        const yearAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)
        query = query.gte('created_at', yearAgo.toISOString())
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
        } else {
          const yearAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)
          query = query.gte('created_at', yearAgo.toISOString())
        }
      }

      query = query.order('created_at', { ascending: false })
      const { data: tugasData, error } = await query
      if (error) throw error

      const tugasArr = tugasData || []
      if (tugasArr.length === 0) {
        setTugasList([])
        setMapelOptions([])
        return
      }

      // mapel options dari tugas kelas tsb
      const mapels = [...new Set(tugasArr.map((t) => t.mapel).filter(Boolean))].sort()
      setMapelOptions(mapels)

      // ambil jawaban milik siswa ini untuk tugas-tugas tersebut
      const tugasIds = tugasArr.map((t) => t.id)
      const { data: jawabanData, error: jErr } = await supabase
        .from('tugas_jawaban')
        .select('tugas_id, user_id, nilai, status, file_url, link_url, waktu_submit')
        .eq('user_id', user.id)
        .in('tugas_id', tugasIds)

      if (jErr) throw jErr

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

      if (timeRange === 'custom_months' && selectedMonths.length > 0) {
        const setMonths = new Set(selectedMonths)
        merged = merged.filter((t) => {
          if (!t.created_at) return false
          const d = new Date(t.created_at)
          if (!isValidDate(d)) return false
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          return setMonths.has(ym)
        })
      }

      if (statusFilter !== 'all') {
        merged = merged.filter((t) => t.myStatus === statusFilter)
      }

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase()
        merged = merged.filter((t) => {
          return (
            String(t.judul || '').toLowerCase().includes(q) ||
            String(t.mapel || '').toLowerCase().includes(q) ||
            String(t.keterangan || '').toLowerCase().includes(q)
          )
        })
      }

      setTugasList(merged)
    } catch (error) {
      console.error('Error load tugas list:', error)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal memuat tugas: ${parsed.message}`)
    } finally {
      setLoading(false)
    }
  }, [
    user?.id,
    selectedKelas,
    kelasSiswa,
    selectedMapel,
    timeRange,
    selectedMonths,
    statusFilter,
    searchTerm,
    setLoading,
    pushToast
  ])

  useEffect(() => {
    if (user?.id) loadTugasList()
  }, [user?.id, loadTugasList])

  /* Debounce search */
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      if (user?.id) loadTugasList()
    }, 300)
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm])

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
    setJawabanLink(tugas?.myJawaban?.link_url || '')
    setUploadProgress(null)

    try {
      setIsLoadingDetail(true)

      // ambil data tugas terbaru (optional, biar sinkron)
      const { data: tugasData, error: tErr } = await supabase
        .from('tugas')
        .select('*')
        .eq('id', tugas.id)
        .single()

      if (tErr) throw tErr

      // ambil jawaban milik siswa untuk tugas ini
      const { data: jawabanData, error: jErr } = await supabase
        .from('tugas_jawaban')
        .select('id, tugas_id, user_id, file_url, link_url, nilai, status, waktu_submit')
        .eq('tugas_id', tugas.id)
        .eq('user_id', user.id)
        .maybeSingle()

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

      // set current file key
      if (jawabanData?.file_url) setJawabanFileKey(jawabanData.file_url)

      // fetch file size
      if (jawabanData?.file_url) {
        try {
          const signed = await createSignedUrlForKey(jawabanData.file_url, 60 * 10)
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
    if (selectedTugas) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [selectedTugas])

  /* =========================
     Upload / Delete jawaban
========================= */
  const handleUploadJawabanFile = async (files) => {
    if (!files?.length || !user?.id || !selectedTugas) return
    const file = files[0]

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
      setIsUploading(true)
      setUploadProgress('Mengkompresi file...')

      const compressed = await compressFileBeforeUpload(file)

      const safeName = sanitizeFileName(compressed.name)
      const filePath = `${selectedTugas.id}/${user.id}-${Date.now()}-${safeName}`

      setUploadProgress('Mengupload file...')

      const { error: uploadError } = await supabase.storage
        .from(ASSIGNMENT_BUCKET)
        .upload(filePath, compressed, { upsert: false, cacheControl: '3600' })

      if (uploadError) throw new Error(uploadError.message)

      // hapus file lama (kalau ada) milik siswa sendiri
      if (detail?.myJawaban?.file_url) {
        try {
          await deleteJawabanFileFromStorage(detail.myJawaban.file_url, selectedTugas.id, user.id)
        } catch (e) {
          console.warn('Gagal hapus file lama:', e)
        }
      }

      setJawabanFileKey(filePath)
      setJawabanFileSize(formatFileSize(compressed.size))
      setUploadProgress(null)

      pushToast('success', `File jawaban berhasil diupload (${formatFileSize(compressed.size)})`)
    } catch (error) {
      console.error('Upload jawaban error:', error)
      setUploadProgress(null)
      const parsed = parseSupabaseError(error)
      pushToast('error', `Gagal upload file: ${parsed.message}`)
    } finally {
      setIsUploading(false)
    }
  }

  const handleDeleteJawabanFile = async () => {
    if (!user?.id || !selectedTugas) return
    if (!jawabanFileKey && !detail?.myJawaban?.file_url) return

    const lockReason = getSubmitLockReason(detail?.tugas, detail?.myJawaban, detail?.myStatus)
    if (lockReason) {
      pushToast('error', lockReason)
      return
    }

    // eslint-disable-next-line no-restricted-globals
    if (!confirm('Hapus file jawaban ini?')) return

    try {
      setLoading(true)

      const key = jawabanFileKey || detail?.myJawaban?.file_url
      let storageError = null
      try {
        await deleteJawabanFileFromStorage(key, selectedTugas.id, user.id)
      } catch (err) {
        storageError = err
        console.warn('Delete storage error (non-blocking):', err)
      }

      const existing = detail?.myJawaban || null
      const currentLink = (jawabanLink || existing?.link_url || '').trim()

      if (existing?.id) {
        if (currentLink) {
          const { error } = await supabase
            .from('tugas_jawaban')
            .update({ file_url: null })
            .eq('id', existing.id)
            .eq('user_id', user.id)

          if (error) throw error

          setDetail((prev) => {
            if (!prev) return prev
            const nextJawaban = prev.myJawaban ? { ...prev.myJawaban, file_url: null } : null
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

    // ANTI-IDOR: pastikan tugas untuk kelas siswa
    const kelas = selectedKelas || kelasSiswa
    if (detail.tugas.kelas !== kelas) {
      pushToast('error', 'Akses ditolak: tugas bukan untuk kelas Anda')
      return
    }

    // validasi minimal: harus ada file atau link (pilih salah satu)
    const hasFile = Boolean(jawabanFileKey || detail?.myJawaban?.file_url)
    const link = (jawabanLink || '').trim()
    const hasLink = Boolean(link)

    if (!hasFile && !hasLink) {
      pushToast('error', 'Upload file jawaban atau isi link jawaban')
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

      const payload = {
        tugas_id: selectedTugas.id,
        user_id: user.id,
        file_url: jawabanFileKey || existing?.file_url || null,
        link_url: safeLink || null,
        status: existing?.nilai != null ? 'dinilai' : 'menunggu',
        waktu_submit: new Date().toISOString()
      }

      if (existing?.id) {
        // ANTI-IDOR: update hanya row milik user (RLS harus enforce juga)
        const { error } = await supabase
          .from('tugas_jawaban')
          .update(payload)
          .eq('id', existing.id)
          .eq('user_id', user.id)

        if (error) throw error
      } else {
        const { error } = await supabase.from('tugas_jawaban').insert(payload)
        if (error) throw error
      }

      pushToast('success', 'Jawaban berhasil dikirim')

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

  /* =========================
     Realtime refresh
========================= */
  useEffect(() => {
    if (!user?.id) return

    const channel = supabase
      .channel(`tugas_siswa_${user.id}`)
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
  }, [user?.id, selectedTugas, loadTugasList])

  /* =========================
     Dashboard Stats
========================= */
  const stats = useMemo(() => {
    const total = tugasList.length
    const belum = tugasList.filter((t) => t.myStatus === 'belum').length
    const menunggu = tugasList.filter((t) => t.myStatus === 'menunggu').length
    const dinilai = tugasList.filter((t) => t.myStatus === 'dinilai').length
    return { total, belum, menunggu, dinilai }
  }, [tugasList])

  const submitLockReason = useMemo(() => {
    return getSubmitLockReason(detail?.tugas, detail?.myJawaban, detail?.myStatus)
  }, [detail?.tugas, detail?.myJawaban, detail?.myStatus])

  const isSubmissionLocked = Boolean(submitLockReason)

  /* =========================
     Render
========================= */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50/30 p-4 sm:p-6">
      <div className="max-w-full mx-auto space-y-6">
        {/* HEADER */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                <span className="text-2xl text-white">🧑‍🎓</span>
              </div>
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-slate-800 mb-2">Tugas Saya</h1>
                <p className="text-slate-600 text-base">Lihat tugas kelas, kumpulkan jawaban, dan pantau nilai</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
                <div className="text-xs text-slate-500">Siswa</div>
                <div className="font-semibold text-slate-800">{profile?.nama || '-'}</div>
                <div className="text-xs text-slate-500 mt-1">Kelas: {kelasSiswa || '-'}</div>
              </div>

              <button
                type="button"
                onClick={async () => {
                  pushToast('info', 'Memperbarui data...')
                  await loadTugasList()
                  pushToast('success', 'Data diperbarui')
                }}
                className="px-4 py-3 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors font-semibold text-slate-700 shadow-sm"
              >
                🔄 Refresh
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
              >
                <option value="">Semua mapel</option>
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
                <option value="week">7 hari terakhir</option>
                <option value="all">12 bulan terakhir</option>
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
                setTimeRange('week')
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
              className="px-4 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-bold transition-all shadow-lg"
            >
              🔎 Terapkan
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
            </div>
          </div>

          {tugasList.length === 0 ? (
            <div className="text-center py-14 text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
              <div className="text-6xl mb-4">🗂️</div>
              <div className="font-bold text-slate-700">Belum ada tugas</div>
              <div className="text-sm mt-1">Coba ubah filter atau tunggu guru membuat tugas.</div>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {tugasList.map((t) => {
                const expired = t.isExpired
                const beforeStart = t.isBeforeStart
                const nearDeadline = t.isNearDeadline
                const doneAndGraded = t.myStatus === 'dinilai'
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
                      {t.myJawaban?.file_url && (
                        <span className="px-3 py-1 rounded-full border bg-blue-50 text-blue-700 border-blue-200 text-xs font-bold">
                          📎 Ada file
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
              onClick={() => setSelectedTugas(null)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSelectedTugas(null)
              }}
            />

            <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-6">
              <div className="w-full max-w-5xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
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

                    <div className="flex flex-wrap items-center gap-2 justify-end">
                      {detail?.tugas?.file_url && (
                        <button
                          type="button"
                          onClick={() => openPreview(detail.tugas.file_url)}
                          className="px-4 py-2 rounded-2xl bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-colors"
                        >
                          📎 Lampiran Guru
                        </button>
                      )}
                      {detail?.tugas?.link && (
                        <button
                          type="button"
                          onClick={() => openPreview(detail.tugas.link)}
                          className="px-4 py-2 rounded-2xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
                        >
                          🔗 Link Guru
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setSelectedTugas(null)}
                        className="px-4 py-2 rounded-2xl bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 transition-colors"
                      >
                        ❌ Tutup
                      </button>
                    </div>
                  </div>
                </div>

                {/* Body */}
                <div className="p-5 sm:p-6 max-h-[75vh] overflow-auto">
                  {isLoadingDetail ? (
                    <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
                      <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                      <div className="text-slate-600 font-semibold">Memuat detail...</div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                      {/* Instruksi */}
                      <div className="lg:col-span-2 space-y-4">
                        <div className="bg-white border border-slate-200 rounded-2xl p-4">
                          <div className="text-sm font-bold text-slate-800 mb-2">📌 Instruksi</div>
                          <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                            {detail?.tugas?.keterangan || 'Tidak ada instruksi.'}
                          </div>
                        </div>

                        {detail?.tugas?.link && (
                          <div className="bg-white border border-slate-200 rounded-2xl p-4">
                            <div className="text-sm font-bold text-slate-800 mb-2">🔗 Link Referensi Guru</div>
                            <div className="text-xs text-slate-500 break-all mb-3">{detail.tugas.link}</div>
                            <button
                              type="button"
                              onClick={() => openPreview(detail.tugas.link)}
                              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
                            >
                              👁️ Preview Link
                            </button>
                          </div>
                        )}

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
                              Boleh tanpa http(s) (nanti otomatis ditambahkan).
                            </div>
                          </div>

                          {/* File upload */}
                          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                            <div className="flex items-center justify-between gap-3 mb-3">
                              <div>
                                <div className="font-bold text-slate-800">📎 File jawaban (opsional)</div>
                                <div className="text-xs text-slate-500">
                                  Disimpan ke folder <b>{selectedTugas.id}/</b> dengan prefix <b>{user.id}-</b> (anti-IDOR).
                                </div>
                              </div>

                              {(jawabanFileKey || detail?.myJawaban?.file_url) && (
                                <div className="flex flex-wrap gap-2 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => openPreview(jawabanFileKey || detail?.myJawaban?.file_url)}
                                    className="px-4 py-2 rounded-2xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
                                  >
                                    👁️ Preview
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleDeleteJawabanFile}
                                    className="px-4 py-2 rounded-2xl bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors"
                                    disabled={isSubmissionLocked}
                                  >
                                    🗑️ Hapus
                                  </button>
                                </div>
                              )}
                            </div>

                            {uploadProgress && (
                              <div className="mb-3 p-3 bg-purple-50 border border-purple-200 rounded-xl">
                                <div className="flex items-center gap-2 text-purple-700 text-sm">
                                  <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                                  {uploadProgress}
                                </div>
                              </div>
                            )}

                            {isUploading ? (
                              <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl text-slate-600 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                                  <span>Mengupload file...</span>
                                </div>
                              </div>
                            ) : (jawabanFileKey || detail?.myJawaban?.file_url) ? (
                              <div className="p-4 bg-green-50 border border-green-200 rounded-xl flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                  <span className="text-green-600 text-xl">✅</span>
                                  <div>
                                    <div className="text-sm font-bold text-green-800">File siap</div>
                                    <div className="text-xs text-green-600">
                                      {jawabanFileSize || 'Ukuran akan tampil'} • {isSubmissionLocked ? 'Sudah terkunci' : 'Bisa diganti selama periode pengumpulan'}
                                    </div>
                                  </div>
                                </div>

                                <FileDropzone
                                  onFiles={handleUploadJawabanFile}
                                  accept={ASSIGNMENT_FILE_ACCEPT}
                                  label="Ganti file"
                                  disabled={isSubmissionLocked}
                                  small
                                />
                              </div>
                            ) : (
                              <FileDropzone
                                onFiles={handleUploadJawabanFile}
                                accept={ASSIGNMENT_FILE_ACCEPT}
                                label="Seret file jawaban ke sini atau klik untuk memilih"
                                disabled={isSubmissionLocked}
                              />
                            )}

                            <div className="mt-3 p-3 bg-white rounded-xl border border-slate-200">
                              <p className="text-xs font-semibold text-slate-700 mb-2">📋 Batas Ukuran File:</p>
                              <ul className="text-xs text-slate-600 space-y-1">
                                <li>🖼️ Gambar: maks 100KB (otomatis dikompresi)</li>
                                <li>📄 PDF/Dokumen: maks 2MB</li>
                                <li>📊 PPT: maks 3MB</li>
                              </ul>
                            </div>
                          </div>

                          {/* Submit */}
                          <div className="mt-4 flex flex-col sm:flex-row gap-2">
                            <button
                              type="button"
                              onClick={saveJawaban}
                              disabled={isSubmissionLocked}
                              className="flex-1 px-4 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-bold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              🚀 Kirim Jawaban
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

                      {/* Sidebar info */}
                      <div className="space-y-4">
                        <div className="bg-white border border-slate-200 rounded-2xl p-4">
                          <div className="text-sm font-bold text-slate-800 mb-2">🧠 Status</div>
                          <div className="flex flex-wrap gap-2">
                            <StatusBadge status={detail?.myStatus} />
                            <ScoreBadge nilai={detail?.myJawaban?.nilai} />
                          </div>
                          <div className="text-xs text-slate-500 mt-2">
                            {detail?.myStatus === 'dinilai'
                              ? 'Jawaban Anda sudah dinilai.'
                              : detail?.myStatus === 'menunggu'
                              ? 'Jawaban terkirim dan menunggu penilaian.'
                              : 'Anda belum mengumpulkan.'}
                          </div>
                        </div>

                        {detail?.tugas?.file_url && (
                          <div className="bg-white border border-slate-200 rounded-2xl p-4">
                            <div className="text-sm font-bold text-slate-800 mb-2">📎 Lampiran Guru</div>
                            <button
                              type="button"
                              onClick={() => openPreview(detail.tugas.file_url)}
                              className="w-full px-4 py-3 rounded-2xl bg-purple-600 text-white font-bold hover:bg-purple-700 transition-colors"
                            >
                              👁️ Preview Lampiran
                            </button>
                            <div className="text-[11px] text-slate-500 mt-2">
                              Jika bucket private, preview akan sukses hanya jika policy storage mengizinkan.
                            </div>
                          </div>
                        )}

                        {detail?.tugas?.link && (
                          <div className="bg-white border border-slate-200 rounded-2xl p-4">
                            <div className="text-sm font-bold text-slate-800 mb-2">🔗 Link Referensi Guru</div>
                            <button
                              type="button"
                              onClick={() => openPreview(detail.tugas.link)}
                              className="w-full px-4 py-3 rounded-2xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition-colors"
                            >
                              👁️ Preview Link
                            </button>
                          </div>
                        )}
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
      </div>
    </div>
  )
}
