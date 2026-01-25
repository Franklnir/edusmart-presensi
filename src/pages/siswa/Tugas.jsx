import React, { useState, useEffect, useMemo } from 'react'
import { supabase, ASSIGNMENT_BUCKET } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import FileDropzone from '../../components/FileDropzone'
import FilePreviewModal from '../../components/FilePreviewModal'

/* ================ Constants & Helpers ================ */
const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
]

const FILE_SIZE_LIMITS = {
  IMAGE: 70 * 1024,
  PDF: 2 * 1024 * 1024,
  DOCUMENT: 2 * 1024 * 1024,
  PRESENTATION: 3 * 1024 * 1024,
  OTHER: 5 * 1024 * 1024
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

const formatDate = (dateStringOrDate) => {
  if (!dateStringOrDate) return '-'
  const d = typeof dateStringOrDate === 'string'
    ? new Date(dateStringOrDate)
    : dateStringOrDate
  if (!isValidDate(d)) return '-'
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

const formatFileSize = (bytes) => {
  if (!bytes) return '0 B'
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i]
}

const isProbablyUrl = (value) => {
  if (!value || typeof value !== 'string') return false
  return value.startsWith('http://') || value.startsWith('https://')
}

const extractObjectPathFromUrlOrPath = (urlOrPath, bucketName) => {
  if (!urlOrPath) return null
  if (!isProbablyUrl(urlOrPath)) return urlOrPath
  try {
    const u = new URL(urlOrPath)
    const pathname = u.pathname
    const parts = pathname.split('/').filter(Boolean)
    const bucketIndex = parts.indexOf(bucketName)
    if (bucketIndex !== -1 && bucketIndex + 1 < parts.length) {
      return parts.slice(bucketIndex + 1).join('/')
    }
    const publicIdx = parts.indexOf('public')
    if (publicIdx !== -1 && parts[publicIdx + 1] === bucketName) {
      return parts.slice(publicIdx + 2).join('/')
    }
    const signIdx = parts.indexOf('sign')
    if (signIdx !== -1 && parts[signIdx + 1] === bucketName) {
      return parts.slice(signIdx + 2).join('/')
    }
    return urlOrPath
  } catch {
    return urlOrPath
  }
}

const getFileExtFromUrl = (urlOrPath) => {
  if (!urlOrPath) return ''
  const clean = urlOrPath.split('?')[0]
  const last = clean.split('/').pop() || ''
  return (last.split('.').pop() || '').toLowerCase()
}

/* ================ File Compression ================ */
const compressImage = async (file, maxSizeKB = 70, initialQuality = 0.9) => {
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
        const compressIteration = () => {
          canvas.width = width
          canvas.height = height
          ctx.drawImage(img, 0, 0, width, height)
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Gagal mengkompresi gambar'))
                return
              }
              const currentSizeKB = blob.size / 1024
              if (currentSizeKB > maxSizeKB && quality > 0.3) {
                quality -= 0.1
                width = Math.floor(width * 0.85)
                height = Math.floor(height * 0.85)
                if (width < 100 || height < 100) {
                  const compressedFile = new File([blob], file.name, {
                    type: file.type,
                    lastModified: Date.now()
                  })
                  resolve(compressedFile)
                  return
                }
                compressIteration()
              } else {
                const compressedFile = new File([blob], file.name, {
                  type: file.type,
                  lastModified: Date.now()
                })
                resolve(compressedFile)
              }
            },
            file.type,
            quality
          )
        }
        compressIteration()
      }
      img.onerror = () => reject(new Error('Gagal memuat gambar'))
      img.src = event.target?.result
    }
    reader.onerror = () => reject(new Error('Gagal membaca file'))
    reader.readAsDataURL(file)
  })
}

const validateMaxSize = (file, maxBytes, label) => {
  if (file.size <= maxBytes) return file
  const maxMB = Math.round((maxBytes / (1024 * 1024)) * 100) / 100
  throw new Error(`File ${label} terlalu besar (${formatFileSize(file.size)}). Maksimal ${maxMB}MB.`)
}

const compressFileBeforeUpload = async (file) => {
  const fileType = file.type || ''
  const fileName = (file.name || '').toLowerCase()
  if (fileType.startsWith('image/')) {
    return await compressImage(file, FILE_SIZE_LIMITS.IMAGE / 1024)
  }
  if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
    return validateMaxSize(file, FILE_SIZE_LIMITS.PDF, 'PDF')
  }
  if (
    fileType.includes('presentation') ||
    fileName.endsWith('.ppt') ||
    fileName.endsWith('.pptx')
  ) {
    return validateMaxSize(file, FILE_SIZE_LIMITS.PRESENTATION, 'presentasi')
  }
  if (
    fileType.includes('document') ||
    fileName.endsWith('.doc') ||
    fileName.endsWith('.docx') ||
    fileName.endsWith('.odt') ||
    fileName.endsWith('.rtf')
  ) {
    return validateMaxSize(file, FILE_SIZE_LIMITS.DOCUMENT, 'dokumen')
  }
  return validateMaxSize(file, FILE_SIZE_LIMITS.OTHER, 'lainnya')
}

/* ================ Status & Deadline Helpers ================ */
const getStatusInfo = (tugas, jawaban) => {
  const now = new Date()
  const deadline = new Date(tugas?.deadline)
  const deadlineOk = isValidDate(deadline)
  if (!jawaban) {
    if (deadlineOk && now > deadline) {
      return {
        status: 'terlambat',
        text: '⏰ Terlambat',
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200'
      }
    }
    return {
      status: 'belum',
      text: '📝 Belum Dikumpulkan',
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      borderColor: 'border-orange-200'
    }
  }
  if (jawaban.nilai != null) {
    return {
      status: 'dinilai',
      text: `✅ Sudah Dinilai (${jawaban.nilai})`,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200',
      nilai: jawaban.nilai
    }
  }
  return {
    status: 'dikumpulkan',
    text: '📤 Sudah Dikumpulkan',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200'
  }
}

const getDeadlineInfo = (deadline) => {
  const now = new Date()
  const deadlineDate = new Date(deadline)
  if (!isValidDate(deadlineDate)) {
    return {
      text: '-',
      color: 'text-slate-600',
      bgColor: 'bg-slate-100',
      urgent: false
    }
  }
  const diffMs = deadlineDate - now
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  const diffHours = Math.ceil(diffMs / (1000 * 60 * 60))
  if (diffMs < 0) {
    return {
      text: 'Deadline sudah lewat',
      color: 'text-red-600',
      bgColor: 'bg-red-100',
      urgent: true
    }
  }
  if (diffHours <= 24) {
    return {
      text: `Tinggal ${diffHours} jam lagi!`,
      color: 'text-orange-600',
      bgColor: 'bg-orange-100',
      urgent: true
    }
  }
  if (diffDays <= 3) {
    return {
      text: `Tinggal ${diffDays} hari lagi`,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-100',
      urgent: true
    }
  }
  return {
    text: formatDateTime(deadline),
    color: 'text-slate-600',
    bgColor: 'bg-slate-100',
    urgent: false
  }
}

const getWeekRange = () => {
  const today = new Date()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - today.getDay())
  const endOfWeek = new Date(today)
  endOfWeek.setDate(today.getDate() + (6 - today.getDay()))
  return {
    start: startOfWeek.toISOString().split('T')[0],
    end: endOfWeek.toISOString().split('T')[0]
  }
}

const getTimeFilterLabel = (value) => {
  if (!value || value === 'all') return ''
  if (value === 'minggu-ini') return 'Minggu ini'
  if (value.startsWith('bulan-')) {
    const idx = parseInt(value.split('-')[1], 10) - 1
    return MONTH_NAMES[idx] || 'Bulan'
  }
  return ''
}

/* ================ Storage Helpers ================ */
const createSignedUrlSafe = async (objectPath, expiresInSec = 60 * 30) => {
  if (!objectPath) return null
  const { data, error } = await supabase.storage
    .from(ASSIGNMENT_BUCKET)
    .createSignedUrl(objectPath, expiresInSec)
  if (error) throw error
  return data?.signedUrl || null
}

const resolvePreviewOrDownloadUrl = async (fileRefOrUrl) => {
  if (!fileRefOrUrl) return null
  if (isProbablyUrl(fileRefOrUrl) && !fileRefOrUrl.includes('/storage/v1/object/')) {
    return fileRefOrUrl
  }
  const objectPath = extractObjectPathFromUrlOrPath(fileRefOrUrl, ASSIGNMENT_BUCKET)
  if (!objectPath) return null
  return await createSignedUrlSafe(objectPath, 60 * 30)
}

const deleteFileFromStorage = async (fileRefOrUrl) => {
  if (!fileRefOrUrl) return
  try {
    const objectPath = extractObjectPathFromUrlOrPath(fileRefOrUrl, ASSIGNMENT_BUCKET)
    if (!objectPath) return
    const { error } = await supabase.storage
      .from(ASSIGNMENT_BUCKET)
      .remove([objectPath])
    if (error) throw error
  } catch (error) {
    console.error('deleteFileFromStorage error:', error)
  }
}

/* ================ Main Component ================ */
export default function TugasSiswa() {
  const { user, profile } = useAuthStore()
  const { pushToast, setLoading } = useUIStore()

  const [tugasList, setTugasList] = useState([])
  const [jawabanMap, setJawabanMap] = useState({})
  const [selectedTugas, setSelectedTugas] = useState(null)
  const [selectedMapel, setSelectedMapel] = useState('semua')
  const [timeFilter, setTimeFilter] = useState('all')
  const [file, setFile] = useState(null)
  const [link, setLink] = useState('')
  const [uploadedFileSize, setUploadedFileSize] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [compressionProgress, setCompressionProgress] = useState(null)
  const [previewFile, setPreviewFile] = useState(null)

  /* ========== Data Loading ========== */
  const loadTugas = async () => {
    if (!profile?.kelas) return
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('tugas')
        .select('*')
        .eq('kelas', profile.kelas)
        .order('created_at', { ascending: false })
      if (error) throw error
      setTugasList(data || [])
    } catch (error) {
      console.error('Error loading tugas:', error)
      pushToast('error', 'Gagal memuat data tugas: ' + (error?.message || 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  const loadJawabanSaya = async () => {
    if (!user?.id) return
    try {
      const { data, error } = await supabase
        .from('tugas_jawaban')
        .select('*')
        .eq('user_id', user.id)
      if (error) throw error
      const map = {}
      data?.forEach((jawaban) => {
        map[jawaban.tugas_id] = jawaban
      })
      setJawabanMap(map)
    } catch (error) {
      console.error('Error loading jawaban:', error)
      pushToast('error', 'Gagal memuat data jawaban: ' + (error?.message || 'Unknown error'))
    }
  }

  useEffect(() => {
    if (profile?.kelas) {
      loadTugas()
      loadJawabanSaya()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.kelas, user?.id])

  /* ========== Data Processing & Filtering ========== */
  const { filteredTugas, stats, mapelList, mapelStats, mapelGuru } = useMemo(() => {
    if (!tugasList.length) {
      return {
        filteredTugas: [],
        stats: { total: 0, belum: 0, dikumpulkan: 0, dinilai: 0, terlambat: 0, mingguIni: 0 },
        mapelList: [],
        mapelStats: {},
        mapelGuru: {}
      }
    }
    const now = new Date()
    const oneWeekAhead = new Date(now)
    oneWeekAhead.setDate(now.getDate() + 7)
    const weekRange = getWeekRange()
    const mapelSet = new Set()
    const mapelGuruTmp = {}
    const tugasMingguIni = []
    const statsTmp = {
      total: tugasList.length,
      belum: 0,
      dikumpulkan: 0,
      dinilai: 0,
      terlambat: 0,
      mingguIni: 0
    }
    const mapelStatsTmp = {}
    tugasList.forEach((tugas) => {
      const jawaban = jawabanMap[tugas.id]
      const statusInfo = getStatusInfo(tugas, jawaban)
      const mapel = tugas.mapel || 'Lainnya'
      mapelSet.add(mapel)
      if (!mapelStatsTmp[mapel]) {
        mapelStatsTmp[mapel] = {
          total: 0,
          sudahDinilai: 0,
          belumDinilai: 0,
          belumDikumpulkan: 0,
          sudahDeadline: 0,
          upcomingWithinWeek: 0
        }
      }
      if (!mapelGuruTmp[mapel]) {
        mapelGuruTmp[mapel] =
          tugas.guru_nama ||
          tugas.nama_guru ||
          tugas.guru ||
          tugas.pengampu ||
          '-'
      }
      mapelStatsTmp[mapel].total += 1
      if (statusInfo.status === 'dinilai') {
        statsTmp.dinilai += 1
        mapelStatsTmp[mapel].sudahDinilai += 1
      } else if (statusInfo.status === 'dikumpulkan') {
        statsTmp.dikumpulkan += 1
        mapelStatsTmp[mapel].belumDinilai += 1
      } else if (statusInfo.status === 'belum') {
        statsTmp.belum += 1
        mapelStatsTmp[mapel].belumDikumpulkan += 1
      } else if (statusInfo.status === 'terlambat') {
        statsTmp.terlambat += 1
        mapelStatsTmp[mapel].sudahDeadline += 1
      }
      const deadlineDate = new Date(tugas.deadline)
      if (isValidDate(deadlineDate)) {
        const deadlineStr = deadlineDate.toISOString().split('T')[0]
        if (deadlineStr >= weekRange.start && deadlineStr <= weekRange.end) {
          tugasMingguIni.push(tugas)
        }
        if (deadlineDate >= now && deadlineDate <= oneWeekAhead) {
          mapelStatsTmp[mapel].upcomingWithinWeek += 1
        }
      }
    })
    statsTmp.mingguIni = tugasMingguIni.length
    let filtered = [...tugasList]
    if (selectedMapel && selectedMapel !== 'semua') {
      filtered = filtered.filter((t) => t.mapel === selectedMapel)
    }
    if (timeFilter && timeFilter !== 'all') {
      if (timeFilter === 'minggu-ini') {
        const start = new Date()
        const end = new Date()
        start.setDate(start.getDate() - start.getDay())
        end.setDate(end.getDate() + (6 - end.getDay()))
        const startStr = start.toISOString().split('T')[0]
        const endStr = end.toISOString().split('T')[0]
        filtered = filtered.filter((t) => {
          const d = new Date(t.deadline)
          if (!isValidDate(d)) return false
          const dStr = d.toISOString().split('T')[0]
          return dStr >= startStr && dStr <= endStr
        })
      } else if (timeFilter.startsWith('bulan-')) {
        const monthIndex = parseInt(timeFilter.split('-')[1], 10) - 1
        filtered = filtered.filter((t) => {
          const d = new Date(t.deadline)
          if (!isValidDate(d)) return false
          return d.getMonth() === monthIndex
        })
      }
    }
    if (selectedMapel && selectedMapel !== 'semua') {
      filtered.sort((a, b) => {
        const aDate = new Date(a.created_at || a.deadline)
        const bDate = new Date(b.created_at || b.deadline)
        return (isValidDate(bDate) ? bDate.getTime() : 0) - (isValidDate(aDate) ? aDate.getTime() : 0)
      })
    } else {
      filtered.sort((a, b) => {
        const ad = new Date(a.deadline)
        const bd = new Date(b.deadline)
        return (isValidDate(ad) ? ad.getTime() : 0) - (isValidDate(bd) ? bd.getTime() : 0)
      })
    }
    const mapelListArr = Array.from(mapelSet).sort()
    return {
      filteredTugas: filtered,
      stats: statsTmp,
      mapelList: mapelListArr,
      mapelStats: mapelStatsTmp,
      mapelGuru: mapelGuruTmp
    }
  }, [tugasList, jawabanMap, selectedMapel, timeFilter])

  const showLimitedForSelectedMapel =
    selectedMapel && selectedMapel !== 'semua' && timeFilter === 'all'
  const visibleTugas = showLimitedForSelectedMapel
    ? filteredTugas.slice(0, 5)
    : filteredTugas
  const isLimited = showLimitedForSelectedMapel && filteredTugas.length > 5
  const selectedMapelStats =
    selectedMapel &&
    selectedMapel !== 'semua' &&
    mapelStats[selectedMapel]
      ? mapelStats[selectedMapel]
      : null

  /* ========== File Upload Handlers ========== */
  const handleFileSelect = async (files) => {
    if (!files?.length) return
    if (files.length > 1) {
      const allImages = files.every((f) => f?.type?.startsWith('image/'))
      pushToast(
        'info',
        allImages
          ? 'Anda memilih beberapa foto. Untuk banyak foto, lebih baik upload semua ke Google Drive lalu kirim satu link folder di kolom link jawaban.'
          : 'Anda memilih lebih dari 1 file. Sistem hanya akan memakai file pertama. Jika butuh mengirim banyak foto, upload ke Google Drive lalu kirim satu link folder di kolom link jawaban.'
      )
    }
    const selectedFile = files[0]
    try {
      setCompressionProgress('Mengkompresi dan memvalidasi file...')
      const compressedFile = await compressFileBeforeUpload(selectedFile)
      setFile(compressedFile)
      setUploadedFileSize(formatFileSize(compressedFile.size))
      pushToast('success', `File siap diupload: ${formatFileSize(compressedFile.size)}`)
    } catch (error) {
      console.error('Error kompresi file:', error)
      pushToast('error', error?.message || 'Gagal memproses file')
      setFile(null)
      setUploadedFileSize('')
    } finally {
      setCompressionProgress(null)
    }
  }

  const removeFile = () => {
    setFile(null)
    setUploadedFileSize('')
  }

  /* ========== Submit Jawaban Handler ========== */
  const submitJawaban = async () => {
    if (!selectedTugas || !user?.id) {
      return pushToast('error', 'Pilih tugas terlebih dahulu')
    }
    const existingJawaban = jawabanMap[selectedTugas.id]
    const now = new Date()
    const deadline = new Date(selectedTugas.deadline)
    const isDeadlinePassed = isValidDate(deadline) ? now > deadline : false
    if (existingJawaban?.nilai != null) {
      return pushToast('error', 'Tugas sudah dinilai, jawaban tidak dapat diperbarui lagi')
    }
    if (isDeadlinePassed) {
      return pushToast(
        'error',
        existingJawaban
          ? 'Deadline sudah lewat, jawaban tidak dapat diubah lagi'
          : 'Tidak dapat mengumpulkan tugas karena deadline sudah lewat'
      )
    }
    const trimmedLink = (link || '').trim()
    if (!file && !trimmedLink) {
      return pushToast('error', 'Upload file atau masukkan link jawaban terlebih dahulu')
    }
    if (trimmedLink) {
      try {
        // eslint-disable-next-line no-new
        new URL(trimmedLink)
      } catch {
        return pushToast('error', 'Link tidak valid. Pastikan formatnya seperti https://...')
      }
    }
    try {
      setIsSubmitting(true)
      setLoading(true)
      let fileRef = null
      let fileName = null
      let fileToUpload = file
      if (fileToUpload) {
        fileToUpload = await compressFileBeforeUpload(fileToUpload)
        if (existingJawaban?.file_url) {
          await deleteFileFromStorage(existingJawaban.file_url)
        }
        const ext = (fileToUpload.name || '').split('.').pop() || 'bin'
        const objectPath = `jawaban/${selectedTugas.id}/${user.id}/${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from(ASSIGNMENT_BUCKET)
          .upload(objectPath, fileToUpload, {
            upsert: false,
            cacheControl: '3600'
          })
        if (uploadError) {
          throw new Error('Gagal mengupload file: ' + uploadError.message)
        }
        fileRef = objectPath
        fileName = fileToUpload.name
      } else if (existingJawaban?.file_url) {
        fileRef = existingJawaban.file_url
        fileName = existingJawaban.file_name || null
      }
      let error
      if (existingJawaban) {
        const { error: updateError } = await supabase
          .from('tugas_jawaban')
          .update({
            file_url: fileRef,
            file_name: fileName,
            link_url: trimmedLink || null,
            waktu_submit: new Date().toISOString(),
            status: 'submitted'
          })
          .eq('id', existingJawaban.id)
        error = updateError
      } else {
        const { error: insertError } = await supabase
          .from('tugas_jawaban')
          .insert({
            tugas_id: selectedTugas.id,
            user_id: user.id,
            file_url: fileRef,
            file_name: fileName,
            link_url: trimmedLink || null,
            waktu_submit: new Date().toISOString(),
            status: 'submitted'
          })
        error = insertError
      }
      if (error) throw error
      pushToast('success', existingJawaban ? 'Jawaban berhasil diperbarui!' : 'Jawaban berhasil dikumpulkan!')
      setFile(null)
      setLink('')
      setUploadedFileSize('')
      await loadJawabanSaya()
    } catch (error) {
      console.error('Error submitting jawaban:', error)
      pushToast('error', `Gagal mengumpulkan jawaban: ${error?.message || 'Unknown error'}`)
    } finally {
      setIsSubmitting(false)
      setLoading(false)
    }
  }

  /* ========== Render Helper ========== */
  const renderFileLink = (fileRefOrUrl, text, fileNameOrSize = '') => {
    if (!fileRefOrUrl) return null
    const handlePreview = async (e) => {
      e.preventDefault()
      e.stopPropagation()
      try {
        const resolved = await resolvePreviewOrDownloadUrl(fileRefOrUrl)
        if (!resolved) return pushToast('error', 'Gagal membuka file')
        setPreviewFile(resolved)
      } catch (err) {
        pushToast('error', 'Gagal membuat link akses file: ' + (err?.message || 'Unknown error'))
      }
    }
    const handleDownload = async (e) => {
      e.preventDefault()
      e.stopPropagation()
      try {
        const resolved = await resolvePreviewOrDownloadUrl(fileRefOrUrl)
        if (!resolved) return pushToast('error', 'Gagal membuka file')
        window.open(resolved, '_blank', 'noopener,noreferrer')
      } catch (err) {
        pushToast('error', 'Gagal membuat link download: ' + (err?.message || 'Unknown error'))
      }
    }
    const ext = getFileExtFromUrl(fileRefOrUrl)
    const isImage = ['jpeg', 'jpg', 'gif', 'png', 'webp', 'bmp'].includes(ext)
    const icon = isImage ? '🖼️' : '📄'
    const extraInfo = fileNameOrSize ? ` (${fileNameOrSize})` : ''
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handlePreview}
          className="inline-flex items-center gap-2 px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200 transition-colors group"
          type="button"
        >
          <span className="text-base">{icon}</span>
          <span>
            {text}
            {extraInfo}
          </span>
          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-blue-500 text-xs">
            👁️ Preview
          </span>
        </button>
        <button
          onClick={handleDownload}
          className="inline-flex items-center gap-2 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
          type="button"
          title="Download"
        >
          <span>⬇️</span>
          <span className="text-xs">Download</span>
        </button>
      </div>
    )
  }

  /* ========== Auto-select & Reset Effects ========== */
  useEffect(() => {
    if (!selectedTugas && filteredTugas.length > 0) {
      setSelectedTugas(filteredTugas[0])
    }
  }, [filteredTugas, selectedTugas])

  useEffect(() => {
    if (selectedTugas) {
      const jawaban = jawabanMap[selectedTugas.id]
      setLink(jawaban?.link_url || '')
      setFile(null)
      setUploadedFileSize('')
    }
  }, [selectedTugas, jawabanMap])

  /* ========== Render Tabel Tugas ========== */
  const renderTugasTable = (list) => {
    if (!list.length) {
      return (
        <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-slate-200">
          <div className="text-6xl mb-4">📝</div>
          <p className="font-medium text-lg">Tidak ada tugas</p>
          <p className="text-sm mt-2">
            {selectedMapel === 'semua' && timeFilter === 'all'
              ? 'Belum ada tugas untuk kelas Anda'
              : 'Tidak ada tugas dengan filter yang dipilih'}
          </p>
        </div>
      )
    }
    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full table-auto">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="w-[32%] px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide">
                Tugas
              </th>
              <th className="w-[20%] px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide">
                Mapel
              </th>
              <th className="w-[22%] px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide">
                Deadline
              </th>
              <th className="w-[18%] px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide">
                Status
              </th>
              <th className="w-[8%] px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase tracking-wide">
                Aksi
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {list.map((tugas) => {
              const jawaban = jawabanMap[tugas.id]
              const statusInfo = getStatusInfo(tugas, jawaban)
              const deadlineInfo = getDeadlineInfo(tugas.deadline)
              return (
                <tr
                  key={tugas.id}
                  className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                    selectedTugas?.id === tugas.id ? 'bg-blue-50' : ''
                  }`}
                  onClick={() => setSelectedTugas(tugas)}
                >
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <span className="text-blue-600 text-lg">📘</span>
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-slate-800 truncate">
                          {tugas.judul}
                        </div>
                        {tugas.keterangan && (
                          <div className="text-xs text-slate-600 mt-1 line-clamp-1">
                            {tugas.keterangan}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-col gap-1 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-blue-500 rounded-full" />
                        <span className="font-medium text-slate-700 truncate">
                          {tugas.mapel}
                        </span>
                      </div>
                      {(tugas.guru_nama || tugas.nama_guru || tugas.guru || tugas.pengampu) && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-500">
                          <span>👨‍🏫</span>
                          <span className="truncate">
                            {tugas.guru_nama || tugas.nama_guru || tugas.guru || tugas.pengampu}
                          </span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div
                      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${deadlineInfo.bgColor} ${deadlineInfo.color}`}
                    >
                      {formatDateTime(tugas.deadline)}
                    </div>
                    {deadlineInfo.urgent && (
                      <div className="text-[11px] text-red-600 mt-1 font-medium">
                        {deadlineInfo.text}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span
                      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${statusInfo.bgColor} ${statusInfo.color}`}
                    >
                      {statusInfo.text}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedTugas(tugas)
                      }}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-xs"
                      type="button"
                    >
                      Detail
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const renderSubmissionForm = (mode = 'new') => {
    const isUpdate = mode === 'update'
    return (
      <div className="space-y-4 mt-3">
        {/* File Upload Section */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2">
            📎 {isUpdate ? 'Upload ulang file jawaban (opsional)' : 'Upload file jawaban'}
          </label>
          {compressionProgress && (
            <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-2 text-blue-700 text-sm">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                {compressionProgress}
              </div>
            </div>
          )}
          {file ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="text-green-600 text-lg">✅</span>
                  <div>
                    <div className="text-sm font-medium text-green-800">
                      {file.name}
                    </div>
                    <div className="text-xs text-green-600">
                      {uploadedFileSize} • Siap diupload
                    </div>
                  </div>
                </div>
                <button
                  className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200 transition-colors font-medium"
                  onClick={removeFile}
                  type="button"
                >
                  Hapus
                </button>
              </div>
            </div>
          ) : (
            <FileDropzone
              onFiles={handleFileSelect}
              accept="*/*"
              maxSize={10 * 1024 * 1024}
              label="Seret file jawaban ke sini atau klik untuk memilih"
            />
          )}
          <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs font-semibold text-slate-700 mb-2">
              📋 Batas Ukuran & Saran Upload:
            </p>
            <ul className="text-xs text-slate-600 space-y-1">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                <span>Gambar (JPEG/PNG): <strong>maks. 70KB</strong> (otomatis dikompresi).</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                <span>PDF & Dokumen: <strong>maks. 2MB</strong>. Kalau lebih besar, kompres dulu PDF-nya.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-orange-500 rounded-full" />
                <span>Presentasi (PPT): <strong>maks. 3MB</strong>.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
                <span>File lainnya: <strong>maks. 5MB</strong>.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-pink-500 rounded-full" />
                <span>
                  Jika butuh mengirim <strong>lebih dari 1 foto</strong>, lebih rapi kalau semua foto diupload ke{' '}
                  <strong>Google Drive</strong>, lalu kirim <strong>1 link folder</strong> di kolom link jawaban di bawah.
                </span>
              </li>
            </ul>
          </div>
        </div>
        {/* Link Input Section */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2">
            🔗 Atau Link Jawaban (Opsional)
          </label>
          <input
            type="url"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-colors text-sm"
            placeholder="https://drive.google.com/... atau https://docs.google.com/..."
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <p className="text-xs text-slate-500 mt-1">
            Gunakan Google Drive (folder berisi banyak foto), Google Docs, GitHub, Figma, atau platform lainnya.
          </p>
        </div>
        {/* Submit Button */}
        <button
          className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-3 px-4 rounded-lg transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
          onClick={submitJawaban}
          disabled={isSubmitting || (!file && !(link || '').trim())}
          type="button"
        >
          {isSubmitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Mengirim...
            </>
          ) : (
            <>
              <span>📤</span>
              <span>{isUpdate ? 'Perbarui Jawaban' : 'Kumpulkan Jawaban'}</span>
            </>
          )}
        </button>
        <p className="text-xs text-slate-500 text-center">
          Pastikan file atau link sudah benar sebelum mengirim. Foto akan otomatis dikompresi, dan untuk banyak foto disarankan pakai link Google Drive.
        </p>
      </div>
    )
  }

  /* ========== Main Render ========== */
  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="w-full px-3 sm:px-4 lg:px-5 space-y-5">
        {/* Header utama */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                <span className="text-xl text-white">📚</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-800 mb-1">
                  Tugas Siswa
                </h1>
                <p className="text-slate-600 text-sm">
                  Kelola dan kumpulkan tugas untuk kelas {profile?.kelas}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-slate-500">Total Tugas</div>
                <div className="text-xl font-bold text-slate-800">
                  {stats.total}
                </div>
              </div>
              <button
                onClick={() => {
                  loadTugas()
                  loadJawabanSaya()
                  setSelectedMapel('semua')
                  setTimeFilter('all')
                  setSelectedTugas(null)
                  pushToast('info', 'Data diperbarui')
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-lg flex items-center gap-2 text-sm"
                type="button"
              >
                <span>🔄</span>
                <span>Refresh</span>
              </button>
            </div>
          </div>
        </div>

        {/* Card Mata Pelajaran */}
        {mapelList.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <span>📚</span>
                <span>Mata Pelajaran</span>
              </h2>
              {selectedMapel !== 'semua' && (
                <button
                  onClick={() => {
                    setSelectedMapel('semua')
                    setTimeFilter('all')
                    setSelectedTugas(null)
                  }}
                  className="px-3 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs hover:bg-slate-200 transition-colors"
                  type="button"
                >
                  Reset Pilihan
                </button>
              )}
            </div>
            <div className="grid xs:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {mapelList.map((mapel) => {
                const ms = mapelStats[mapel] || {}
                const total = ms.total || 0
                const graded = ms.sudahDinilai || 0
                const submitted = (ms.sudahDinilai || 0) + (ms.belumDinilai || 0)
                const upcoming = ms.upcomingWithinWeek || 0
                const guruLabel = mapelGuru[mapel]
                let borderClass = 'border-slate-200'
                let bgClass = 'bg-slate-50'
                let textClass = 'text-slate-800'
                let badgeText = ''
                let badgeBg = 'bg-slate-100 text-slate-700'
                if (total > 0 && graded === total) {
                  borderClass = 'border-green-200'
                  bgClass = 'bg-green-50'
                  textClass = 'text-green-800'
                  badgeText = 'Aman (semua dinilai)'
                  badgeBg = 'bg-green-100 text-green-700'
                } else if (upcoming > 0) {
                  borderClass = 'border-red-200'
                  bgClass = 'bg-red-50'
                  textClass = 'text-red-800'
                  badgeText = `${upcoming} deadline dekat`
                  badgeBg = 'bg-red-100 text-red-700'
                } else if (submitted > 0) {
                  borderClass = 'border-blue-200'
                  bgClass = 'bg-blue-50'
                  textClass = 'text-blue-800'
                  badgeText = `${submitted} sudah dikumpulkan`
                  badgeBg = 'bg-blue-100 text-blue-700'
                } else {
                  borderClass = 'border-yellow-200'
                  bgClass = 'bg-yellow-50'
                  textClass = 'text-yellow-800'
                  badgeText = 'Belum ada pengumpulan'
                  badgeBg = 'bg-yellow-100 text-yellow-700'
                }
                const isActive = selectedMapel === mapel
                return (
                  <button
                    key={mapel}
                    onClick={() => {
                      setSelectedMapel(mapel)
                      setTimeFilter('all')
                      setSelectedTugas(null)
                    }}
                    className={`w-full text-left p-4 rounded-xl border ${bgClass} ${borderClass} transition-all duration-200 ${
                      isActive
                        ? 'ring-2 ring-blue-400 shadow-md scale-[1.02]'
                        : 'hover:shadow-md hover:-translate-y-0.5'
                    }`}
                    type="button"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`font-semibold ${textClass}`}>
                        {mapel}
                      </span>
                      <span className="text-lg">📘</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span>{total} tugas</span>
                      {badgeText && (
                        <span className={`px-2 py-0.5 rounded-full ${badgeBg}`}>
                          {badgeText}
                        </span>
                      )}
                    </div>
                    {guruLabel && guruLabel !== '-' && (
                      <div className="flex items-center gap-1 text-xs text-slate-600 mt-2">
                        <span className="text-slate-400">👨‍🏫</span>
                        <span className="truncate">{guruLabel}</span>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Ringkasan mapel terpilih */}
        {selectedMapelStats && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <span>📌</span>
              <span>Ringkasan {selectedMapel}</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                <div className="text-xs text-slate-600 mb-1">Sudah Dinilai</div>
                <div className="text-lg font-bold text-green-700 flex items-center gap-1">
                  <span>✅</span>
                  <span>{selectedMapelStats.sudahDinilai || 0}</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                <div className="text-xs text-slate-600 mb-1">Sudah Dikumpulkan</div>
                <div className="text-lg font-bold text-blue-700 flex items-center gap-1">
                  <span>📤</span>
                  <span>{selectedMapelStats.belumDinilai || 0}</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200">
                <div className="text-xs text-slate-600 mb-1">Belum Dikumpulkan</div>
                <div className="text-lg font-bold text-yellow-700 flex items-center gap-1">
                  <span>⏳</span>
                  <span>{selectedMapelStats.belumDikumpulkan || 0}</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                <div className="text-xs text-slate-600 mb-1">Sudah Deadline</div>
                <div className="text-lg font-bold text-red-700 flex items-center gap-1">
                  <span>⏰</span>
                  <span>{selectedMapelStats.sudahDeadline || 0}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main content: tabel + detail */}
        <div className="grid xl:grid-cols-3 gap-5">
          {/* Tabel Tugas */}
          <div className="xl:col-span-2 space-y-5">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <span>📋</span>
                    <span>
                      {selectedMapel !== 'semua'
                        ? `Daftar Tugas - ${selectedMapel} (${filteredTugas.length})`
                        : `Daftar Tugas (${filteredTugas.length})`}
                    </span>
                  </h2>
                  {isLimited && (
                    <p className="text-xs text-slate-500 mt-1">
                      Menampilkan 5 tugas terbaru. Gunakan filter waktu untuk melihat tugas lainnya.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-600">
                      Filter waktu
                    </span>
                    <select
                      className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={timeFilter}
                      onChange={(e) => setTimeFilter(e.target.value)}
                    >
                      <option value="all">Semua waktu</option>
                      <option value="minggu-ini">Minggu ini</option>
                      {MONTH_NAMES.map((name, idx) => (
                        <option key={name} value={`bulan-${idx + 1}`}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                    {selectedMapel !== 'semua' && (
                      <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                        {selectedMapel}
                      </span>
                    )}
                    {timeFilter !== 'all' && (
                      <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded-full">
                        {getTimeFilterLabel(timeFilter)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {renderTugasTable(visibleTugas)}
            </div>
          </div>

          {/* Detail & Pengumpulan */}
          <div className="xl:col-span-1">
            {selectedTugas && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 sticky top-5">
                <div className="space-y-6">
                  {/* Detail Tugas */}
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                      <span>📖</span>
                      <span>Detail Tugas</span>
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-base font-semibold text-slate-800 mb-2">
                          {selectedTugas.judul}
                        </h4>
                        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 mb-3">
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 bg-blue-500 rounded-full" />
                            {selectedTugas.mapel}
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 bg-green-500 rounded-full" />
                            Kelas {selectedTugas.kelas}
                          </span>
                          {(selectedTugas.guru_nama ||
                            selectedTugas.nama_guru ||
                            selectedTugas.guru ||
                            selectedTugas.pengampu) && (
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 bg-purple-500 rounded-full" />
                              {selectedTugas.guru_nama ||
                                selectedTugas.nama_guru ||
                                selectedTugas.guru ||
                                selectedTugas.pengampu}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">
                            Dibuat
                          </label>
                          <p className="text-sm text-slate-800 font-medium">
                            {formatDateTime(selectedTugas.created_at)}
                          </p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">
                            Deadline
                          </label>
                          <p className="text-sm text-slate-800 font-medium">
                            {formatDateTime(selectedTugas.deadline)}
                          </p>
                        </div>
                      </div>
                      {selectedTugas.keterangan && (
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-2">
                            Keterangan
                          </label>
                          <div className="bg-slate-50 rounded-lg p-3">
                            <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">
                              {selectedTugas.keterangan}
                            </p>
                          </div>
                        </div>
                      )}
                      {selectedTugas.file_url && (
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-2">
                            File Lampiran
                          </label>
                          {renderFileLink(selectedTugas.file_url, '📎 Lampiran Tugas')}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Pengumpulan Jawaban */}
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                      <span>📤</span>
                      <span>Pengumpulan Jawaban</span>
                    </h3>
                    {(() => {
                      const jawaban = jawabanMap[selectedTugas.id]
                      const statusInfo = getStatusInfo(selectedTugas, jawaban)
                      const now = new Date()
                      const deadlineDate = new Date(selectedTugas.deadline)
                      const isDeadlinePassed = isValidDate(deadlineDate) ? now > deadlineDate : false
                      const isGraded = jawaban?.nilai != null
                      if (jawaban) {
                        return (
                          <div className="space-y-4">
                            <div className={`p-3 rounded-xl border ${statusInfo.bgColor} ${statusInfo.borderColor}`}>
                              <div className="flex items-center justify-between mb-2">
                                <span className={`font-semibold text-sm ${statusInfo.color}`}>
                                  {statusInfo.text}
                                </span>
                                {statusInfo.nilai != null && (
                                  <span className="text-xl font-bold text-green-700">
                                    {statusInfo.nilai}
                                  </span>
                                )}
                              </div>
                              <div className="space-y-2">
                                <div className="text-xs text-slate-600">
                                  <p>Dikumpulkan: {formatDateTime(jawaban.waktu_submit)}</p>
                                  {jawaban.dinilai_at && (
                                    <p>Dinilai: {formatDateTime(jawaban.dinilai_at)}</p>
                                  )}
                                </div>
                                <div className="space-y-2">
                                  {jawaban.file_url && (
                                    <div className="flex items-center justify-between p-2 bg-blue-50 rounded-lg">
                                      <div className="flex items-center gap-2">
                                        <span>📎</span>
                                        <span className="text-xs text-blue-700">
                                          File Jawaban
                                        </span>
                                      </div>
                                      {renderFileLink(jawaban.file_url, 'Lihat File', jawaban.file_name)}
                                    </div>
                                  )}
                                  {jawaban.link_url && (
                                    <div className="flex items-center justify-between p-2 bg-purple-50 rounded-lg">
                                      <div className="flex items-center gap-2">
                                        <span>🔗</span>
                                        <span className="text-xs text-purple-700">
                                          Link Jawaban
                                        </span>
                                      </div>
                                      <a
                                        href={jawaban.link_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-2 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700 transition-colors"
                                      >
                                        Buka Link
                                      </a>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            {isGraded ? (
                              <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-center">
                                <div className="text-3xl mb-2">🔒</div>
                                <p className="text-red-800 font-medium text-sm">
                                  Tugas sudah dinilai
                                </p>
                                <p className="text-red-700 text-xs mt-1">
                                  Jawaban tidak dapat diperbarui lagi
                                </p>
                              </div>
                            ) : isDeadlinePassed ? (
                              <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-center">
                                <div className="text-3xl mb-2">⏰</div>
                                <p className="text-red-800 font-medium text-sm">
                                  Deadline sudah lewat
                                </p>
                                <p className="text-red-700 text-xs mt-1">
                                  Jawaban tidak dapat diubah lagi setelah melewati deadline
                                </p>
                              </div>
                            ) : (
                              <>
                                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                                  <p className="text-yellow-800 text-xs font-medium text-center">
                                    ⚠️ Anda dapat memperbarui jawaban selama tugas belum dinilai dan belum melewati deadline
                                  </p>
                                </div>
                                {renderSubmissionForm('update')}
                              </>
                            )}
                          </div>
                        )
                      }
                      if (isDeadlinePassed) {
                        return (
                          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-center">
                            <div className="text-3xl mb-2">⏰</div>
                            <p className="text-red-800 font-medium text-sm">
                              Deadline sudah lewat
                            </p>
                            <p className="text-red-700 text-xs mt-1">
                              Tidak dapat mengumpulkan tugas setelah deadline
                            </p>
                          </div>
                        )
                      }
                      return renderSubmissionForm('new')
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          fileUrl={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  )
}