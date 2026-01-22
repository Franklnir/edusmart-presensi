// src/pages/guru/TugasGuru.jsx
import React, { useState, useEffect, useMemo } from 'react'
import { supabase, ASSIGNMENT_BUCKET } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import FileDropzone from '../../components/FileDropzone'
import FilePreviewModal from '../../components/FilePreviewModal'

/* ================ Constants & Helpers ================ */
const MONTH_NAMES_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember'
]

const FILE_SIZE_LIMITS = {
  IMAGE: 70 * 1024, // 70KB (khusus foto akan dikompres sampai sekitar ini)
  PDF: 2 * 1024 * 1024, // 2MB
  DOCUMENT: 2 * 1024 * 1024, // 2MB
  PRESENTATION: 3 * 1024 * 1024, // 3MB
  OTHER: 5 * 1024 * 1024 // 5MB
}

const getNowDateTimeLocal = () => {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 16)
}

const formatDateTime = (dateString) => {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleString('id-ID', {
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

/* ================ File Compression Functions ================ */

/**
 * Kompresi gambar menggunakan Canvas API
 * Target ±70KB (supaya ringan dan cepat di-load)
 */
const compressImage = async (file, maxSizeKB = 70, initialQuality = 0.9) => {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
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

        let width = img.width
        let height = img.height
        let quality = initialQuality

        console.log(`Kompresi gambar: ${file.name} (${formatFileSize(file.size)})`)
        console.log(`Dimensi awal: ${width}x${height}`)

        const compressIteration = () => {
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

              const currentSizeKB = blob.size / 1024
              console.log(
                `Ukuran saat ini: ${currentSizeKB.toFixed(
                  2
                )}KB, Kualitas: ${quality.toFixed(2)}`
              )

              if (currentSizeKB > maxSizeKB && quality > 0.3) {
                quality -= 0.1
                width = Math.floor(width * 0.85)
                height = Math.floor(height * 0.85)

                if (width < 100 || height < 100) {
                  const compressedFile = new File([blob], file.name, {
                    type: file.type,
                    lastModified: Date.now()
                  })
                  console.log(
                    `Dimensi terlalu kecil, stop kompresi: ${formatFileSize(
                      compressedFile.size
                    )}`
                  )
                  resolve(compressedFile)
                  return
                }

                compressIteration()
              } else {
                const compressedFile = new File([blob], file.name, {
                  type: file.type,
                  lastModified: Date.now()
                })
                console.log(`Kompresi selesai: ${formatFileSize(compressedFile.size)}`)
                resolve(compressedFile)
              }
            },
            file.type,
            quality
          )
        }

        compressIteration()
      }

      img.onerror = () => {
        reject(new Error('Gagal memuat gambar'))
      }

      img.src = event.target.result
    }

    reader.onerror = () => {
      reject(new Error('Gagal membaca file'))
    }

    reader.readAsDataURL(file)
  })
}

const compressPDF = async (file, maxSizeMB = 2) => {
  const maxSizeBytes = maxSizeMB * 1024 * 1024
  if (file.size <= maxSizeBytes) return file
  throw new Error(
    `File PDF terlalu besar (${formatFileSize(file.size)}). Maksimal ${maxSizeMB}MB.`
  )
}

const compressPPT = async (file, maxSizeMB = 3) => {
  const maxSizeBytes = maxSizeMB * 1024 * 1024
  if (file.size <= maxSizeBytes) return file
  throw new Error(
    `File presentasi terlalu besar (${formatFileSize(
      file.size
    )}). Maksimal ${maxSizeMB}MB.`
  )
}

const compressDocument = async (file, maxSizeMB = 2) => {
  const maxSizeBytes = maxSizeMB * 1024 * 1024
  if (file.size <= maxSizeBytes) return file
  throw new Error(
    `File dokumen terlalu besar (${formatFileSize(
      file.size
    )}). Maksimal ${maxSizeMB}MB.`
  )
}

const compressOtherFile = async (file, maxSizeMB = 5) => {
  const maxSizeBytes = maxSizeMB * 1024 * 1024
  if (file.size <= maxSizeBytes) return file
  throw new Error(
    `File terlalu besar (${formatFileSize(file.size)}). Maksimal ${maxSizeMB}MB.`
  )
}

/**
 * Fungsi utama untuk kompresi file sebelum upload
 */
const compressFileBeforeUpload = async (file) => {
  const fileType = file.type
  const fileName = file.name.toLowerCase()

  console.log(`Memulai kompresi file: ${file.name} (${formatFileSize(file.size)})`)

  try {
    if (fileType.startsWith('image/')) {
      console.log('File adalah gambar, memulai kompresi...')
      // Pakai batas dari FILE_SIZE_LIMITS (70KB)
      const compressed = await compressImage(file, FILE_SIZE_LIMITS.IMAGE / 1024)
      console.log(
        `Kompresi gambar selesai: ${compressed.name} (${formatFileSize(
          compressed.size
        )})`
      )
      return compressed
    } else if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
      console.log('Validasi ukuran PDF...')
      return await compressPDF(file, 2)
    } else if (
      fileType.includes('presentation') ||
      fileName.endsWith('.ppt') ||
      fileName.endsWith('.pptx')
    ) {
      console.log('Validasi ukuran PPT...')
      return await compressPPT(file, 3)
    } else if (
      fileType.includes('document') ||
      fileName.endsWith('.doc') ||
      fileName.endsWith('.docx') ||
      fileName.endsWith('.odt') ||
      fileName.endsWith('.rtf')
    ) {
      console.log('Validasi ukuran dokumen...')
      return await compressDocument(file, 2)
    } else {
      console.log('Validasi ukuran file lainnya...')
      return await compressOtherFile(file, 5)
    }
  } catch (error) {
    console.error('Error dalam kompresi file:', error)
    throw error
  }
}

/* ================ File Management ================ */

const deleteFileFromStorage = async (fileUrl) => {
  if (!fileUrl) {
    console.log('Tidak ada file URL yang diberikan')
    return
  }

  try {
    console.log('Menghapus file lama:', fileUrl)

    // Method 1: parse URL
    try {
      const url = new URL(fileUrl)
      const pathParts = url.pathname.split('/')
      const bucketIndex = pathParts.indexOf(ASSIGNMENT_BUCKET)

      if (bucketIndex !== -1) {
        const filePath = pathParts.slice(bucketIndex + 1).join('/')

        console.log('Menghapus file dengan path:', filePath)

        const { error } = await supabase.storage
          .from(ASSIGNMENT_BUCKET)
          .remove([filePath])

        if (error) {
          console.error('Error deleting file (method 1):', error)
          throw error
        } else {
          console.log('File berhasil dihapus (method 1):', filePath)
          return
        }
      }
    } catch (urlError) {
      console.log('Method 1 gagal, mencoba method 2...')
    }

    // Method 2: fallback simple parsing
    const urlParts = fileUrl.split('/')
    const fileName = urlParts[urlParts.length - 1]
    const tugasId = urlParts[urlParts.length - 2]

    if (fileName && tugasId) {
      const filePath = `${tugasId}/${fileName}`
      console.log('Menghapus file dengan path (method 2):', filePath)

      const { error } = await supabase.storage
        .from(ASSIGNMENT_BUCKET)
        .remove([filePath])

      if (error) {
        console.error('Error deleting file (method 2):', error)
      } else {
        console.log('File berhasil dihapus (method 2):', filePath)
        return
      }
    }

    console.warn('Tidak dapat menentukan path file untuk dihapus')
  } catch (error) {
    console.error('Error dalam deleteFileFromStorage:', error)
  }
}

// Konversi slug kelas → tampilan
const formatKelasDisplay = (slug) => {
  if (!slug) return ''
  try {
    return slug
      .split('-')
      .map((part) => part.toUpperCase())
      .join(' ')
  } catch (error) {
    return slug
  }
}

// Inisial nama siswa
const initials = (name = '?') => {
  const parts = (name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() || '').join('')
}

/* ================ Component Utama ================ */
export default function TugasGuru() {
  const { user, profile } = useAuthStore()
  const { pushToast, setLoading } = useUIStore()

  /* ---------- master data ---------- */
  const [jadwalAll, setJadwalAll] = useState([])
  const [kelasList, setKelasList] = useState([])

  /* ---------- form tambah ---------- */
  const [kelas, setKelas] = useState('')
  const [mapelList, setMapelList] = useState([])
  const [selectedMapel, setSelectedMapel] = useState('')
  const [form, setForm] = useState({
    judul: '',
    keterangan: '',
    deadline: getNowDateTimeLocal(),
    file_url: ''
  })
  const [isUploadingFile, setIsUploadingFile] = useState(false)
  const [uploadedFileSizeCreate, setUploadedFileSizeCreate] = useState('')
  const [uploadedFileSizeEdit, setUploadedFileSizeEdit] = useState('')
  const [editExistingFileSize, setEditExistingFileSize] = useState('')
  const [compressionProgress, setCompressionProgress] = useState(null)

  /* ---------- riwayat tugas ---------- */
  const [listTugas, setListTugas] = useState([])
  const [selectedKelasFilter, setSelectedKelasFilter] = useState('')
  const [mapelListFilter, setMapelListFilter] = useState([])
  const [selectedSubject, setSelectedSubject] = useState('')
  const [timeRange, setTimeRange] = useState('week') // 'week' | 'all' | 'custom_months'
  const [filterStatus, setFilterStatus] = useState('all')
  const [selectedMonths, setSelectedMonths] = useState([]) // 'YYYY-MM'[]

  /* ---------- detail & penilaian ---------- */
  const [selectedTugas, setSelectedTugas] = useState(null)
  const [siswaDiKelas, setSiswaDiKelas] = useState([])
  const [jawabanTugas, setJawabanTugas] = useState([])
  const [nilaiInput, setNilaiInput] = useState({})
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [isEditingTugas, setIsEditingTugas] = useState(false)
  const [editForm, setEditForm] = useState(null)

  /* ---------- tugas perlu dinilai ---------- */
  const [tugasPerluDinilai, setTugasPerluDinilai] = useState([])
  const [isLoadingTugasPerluDinilai, setIsLoadingTugasPerluDinilai] =
    useState(false)

  /* ---------- preview file / link (overlay) ---------- */
  const [previewFile, setPreviewFile] = useState(null)

  /* ---------- opsi 12 bulan terakhir ---------- */
  const monthOptions = useMemo(() => {
    const now = new Date()
    const options = []
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const value = `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, '0')}`
      const label = `${MONTH_NAMES_ID[date.getMonth()]} ${date.getFullYear()}`
      options.push({ value, label })
    }
    return options
  }, [])

  /* ========== 0. Effect: Lock Body Scroll saat Overlay Muncul ========== */
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

  /* Reset bulan jika bukan mode custom */
  useEffect(() => {
    if (timeRange !== 'custom_months') {
      setSelectedMonths([])
    }
  }, [timeRange])

  /* ========== 1. Load Data Kelas & Jadwal Guru ========== */
  useEffect(() => {
    const loadKelasData = async () => {
      try {
        const { data, error } = await supabase
          .from('kelas')
          .select('*')
          .order('grade')
          .order('suffix')
        if (error) throw error
        setKelasList(data || [])
      } catch (error) {
        console.error('Error loading kelas data:', error)
      }
    }
    loadKelasData()
  }, [])

  useEffect(() => {
    const loadJadwal = async () => {
      if (!user?.id) return
      try {
        const { data, error } = await supabase
          .from('jadwal')
          .select('*')
          .eq('guru_id', user.id)
        if (error) throw error
        setJadwalAll(data || [])
      } catch (error) {
        console.error('Error loading jadwal:', error)
        pushToast('error', 'Gagal memuat jadwal mengajar')
      }
    }
    loadJadwal()
  }, [user?.id, pushToast])

  /* ========== 2. Kelas & Mapel yang Diampu Guru Ini ========== */
  const { myKelasList } = useMemo(() => {
    if (!jadwalAll.length || !kelasList.length) return { myKelasList: [] }
    const kelasSet = new Set()
    jadwalAll.forEach((j) => {
      if (j.kelas_id) kelasSet.add(j.kelas_id)
    })

    const formattedKelasList = [...kelasSet]
      .map((kelasId) => {
        const kelasData = kelasList.find((k) => k.id === kelasId)
        return {
          id: kelasId,
          nama: kelasData?.nama || formatKelasDisplay(kelasId),
          slug: kelasId
        }
      })
      .sort((a, b) => a.nama.localeCompare(b.nama))
    return { myKelasList: formattedKelasList }
  }, [jadwalAll, kelasList])

  const mapelCards = useMemo(() => {
    if (!jadwalAll.length || !selectedKelasFilter) return []
    const mapels = jadwalAll
      .filter((j) => j.kelas_id === selectedKelasFilter)
      .map((j) => j.mapel)
      .filter((value, index, self) => self.indexOf(value) === index)
      .sort()
    return mapels.map((mapel) => ({ mapel, kelasCount: 1 }))
  }, [jadwalAll, selectedKelasFilter])

  useEffect(() => {
    if (kelas && jadwalAll.length) {
      const mapels = jadwalAll
        .filter((j) => j.kelas_id === kelas)
        .map((j) => j.mapel)
        .filter((value, index, self) => self.indexOf(value) === index)
        .sort()
      setMapelList(mapels)
      if (mapels.length > 0 && !mapels.includes(selectedMapel)) {
        setSelectedMapel(mapels[0])
      } else if (mapels.length === 0) {
        setSelectedMapel('')
      }
    } else {
      setMapelList([])
      setSelectedMapel('')
    }
  }, [kelas, jadwalAll, selectedMapel])

  useEffect(() => {
    if (selectedKelasFilter && jadwalAll.length) {
      const mapels = jadwalAll
        .filter((j) => j.kelas_id === selectedKelasFilter)
        .map((j) => j.mapel)
        .filter((value, index, self) => self.indexOf(value) === index)
        .sort()
      setMapelListFilter(mapels)
      if (mapels.length > 0 && !mapels.includes(selectedSubject)) {
        setSelectedSubject(mapels[0])
      } else if (mapels.length === 0) {
        setSelectedSubject('')
      }
    } else {
      setMapelListFilter([])
      setSelectedSubject('')
    }
  }, [selectedKelasFilter, jadwalAll, selectedSubject])

  /* ========== 3. Loader Riwayat Tugas (dengan statistik + multi bulan) ========== */
  const loadTugas = async () => {
    if (!user?.id) return
    try {
      setLoading(true)
      const now = new Date()

      let query = supabase
        .from('tugas')
        .select(
          'id, kelas, mapel, judul, keterangan, created_at, deadline, file_url, created_by'
        )
        .eq('created_by', user.id)

      if (selectedKelasFilter) query = query.eq('kelas', selectedKelasFilter)
      if (selectedSubject) query = query.eq('mapel', selectedSubject)

      if (filterStatus === 'active') {
        query = query.gte('deadline', now.toISOString())
      } else if (filterStatus === 'expired') {
        query = query.lt('deadline', now.toISOString())
      }

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
            const [yearStr, monthStr] = ym.split('-')
            const year = parseInt(yearStr, 10)
            const month = parseInt(monthStr, 10)
            if (!isNaN(year) && !isNaN(month)) {
              if (year < minYear || (year === minYear && month < minMonth)) {
                minYear = year
                minMonth = month
              }
              if (year > maxYear || (year === maxYear && month > maxMonth)) {
                maxYear = year
                maxMonth = month
              }
            }
          })

          if (minYear !== Infinity) {
            const start = new Date(minYear, minMonth - 1, 1)
            const end = new Date(maxYear, maxMonth, 1)
            query = query
              .gte('created_at', start.toISOString())
              .lt('created_at', end.toISOString())
          }
        } else {
          const yearAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)
          query = query.gte('created_at', yearAgo.toISOString())
        }
      }

      query = query.order('created_at', { ascending: false })
      const { data: tugasRaw, error } = await query
      if (error) throw error

      let tugasData = tugasRaw || []

      // Filter lagi berdasarkan bulan kalau custom_months
      if (timeRange === 'custom_months' && selectedMonths.length > 0) {
        const setMonths = new Set(selectedMonths)
        tugasData = tugasData.filter((t) => {
          if (!t.created_at) return false
          const d = new Date(t.created_at)
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
            2,
            '0'
          )}`
          return setMonths.has(ym)
        })
      }

      let formattedTugas = []

      if (tugasData.length > 0) {
        const tugasIds = tugasData.map((t) => t.id)
        const uniqueKelas = [
          ...new Set(tugasData.map((t) => t.kelas).filter(Boolean))
        ]

        // ====== AMBIL JAWABAN + SISWA UNTUK STATISTIK ======#
        const jawabanPromise =
          tugasIds.length > 0
            ? supabase
                .from('tugas_jawaban')
                .select('tugas_id, user_id, nilai')
                .in('tugas_id', tugasIds)
            : Promise.resolve({ data: [], error: null })

        const siswaPromise =
          uniqueKelas.length > 0
            ? supabase
                .from('profiles')
                .select('id, kelas')
                .eq('role', 'siswa')
                .in('kelas', uniqueKelas)
            : Promise.resolve({ data: [], error: null })

        const [
          { data: jawabanData, error: jawError },
          { data: studentsData, error: studentError }
        ] = await Promise.all([jawabanPromise, siswaPromise])

        if (jawError)
          console.error('Error fetching stats jawaban tugas:', jawError)
        if (studentError)
          console.error('Error fetching students for stats:', studentError)

        const jawabanArr = jawabanData || []
        const siswaArr = studentsData || []

        formattedTugas = tugasData.map((tugas) => {
          // semua siswa di kelas tugas ini
          const siswaKelas = siswaArr.filter((s) => s.kelas === tugas.kelas)
          const totalSiswaDiKelas = siswaKelas.length

          // semua jawaban untuk tugas ini yang benar2 dari siswa di kelas itu
          const jawabanIni = jawabanArr.filter((j) => {
            if (j.tugas_id !== tugas.id) return false
            return siswaKelas.some((s) => s.id === j.user_id)
          })

          // ====== DEDUP per user_id (1 siswa = 1 jawaban) ======#
          const uniqueJawabanByUser = Object.values(
            jawabanIni.reduce((acc, j) => {
              const existing = acc[j.user_id]
              if (!existing) {
                acc[j.user_id] = j
              } else {
                // prioritas jawaban yang sudah dinilai
                if (existing.nilai == null && j.nilai != null) {
                  acc[j.user_id] = j
                } else {
                  // kalau dua-duanya null atau dua-duanya ada nilai, pakai yang terakhir
                  acc[j.user_id] = j
                }
              }
              return acc
            }, {})
          )

          const sudahDinilai = uniqueJawabanByUser.filter(
            (j) => j.nilai !== null
          ).length

          const belumDinilai = uniqueJawabanByUser.filter(
            (j) => j.nilai === null
          ).length

          const totalDikumpulkan = uniqueJawabanByUser.length

          const belumMengerjakan = Math.max(
            0,
            totalSiswaDiKelas - totalDikumpulkan
          )

          return {
            ...tugas,
            kelasDisplay: formatKelasDisplay(tugas.kelas),
            isExpired: new Date(tugas.deadline) < new Date(),
            stats: {
              sudah: sudahDinilai,
              belum_dinilai: belumDinilai,
              belum_mengerjakan: belumMengerjakan,
              total_siswa: totalSiswaDiKelas
            }
          }
        })
      }

      setListTugas(formattedTugas)
    } catch (error) {
      console.error('Error loading tugas:', error)
      pushToast('error', 'Gagal memuat data tugas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user?.id) loadTugas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user?.id,
    selectedKelasFilter,
    selectedSubject,
    timeRange,
    filterStatus,
    selectedMonths
  ])

  /* ========== 4. Load Tugas yang Perlu Dinilai ========== */
  const loadTugasPerluDinilai = async () => {
    if (!user?.id) return
    try {
      setIsLoadingTugasPerluDinilai(true)
      const { data: tugasData, error: tugasError } = await supabase
        .from('tugas')
        .select('id, judul, mapel, kelas, deadline, created_by')
        .eq('created_by', user.id)
      if (tugasError) throw tugasError
      if (!tugasData || tugasData.length === 0) {
        setTugasPerluDinilai([])
        return
      }
      const tugasIds = tugasData.map((t) => t.id)
      const { data: jawabanData, error: jawabanError } = await supabase
        .from('tugas_jawaban')
        .select('*, profiles(nama)')
        .in('tugas_id', tugasIds)
        .is('nilai', null)
      if (jawabanError) throw jawabanError

      const tugasMap = new Map()
      jawabanData?.forEach((jawaban) => {
        const tugas = tugasData.find((t) => t.id === jawaban.tugas_id)
        if (!tugas) return
        if (!tugasMap.has(jawaban.tugas_id)) {
          tugasMap.set(jawaban.tugas_id, { tugas: tugas, jumlah: 0 })
        }
        const item = tugasMap.get(jawaban.tugas_id)
        item.jumlah += 1
      })
      setTugasPerluDinilai(Array.from(tugasMap.values()))
    } catch (error) {
      console.error('Error loading tugas perlu dinilai:', error)
    } finally {
      setIsLoadingTugasPerluDinilai(false)
    }
  }

  useEffect(() => {
    if (user?.id) loadTugasPerluDinilai()
  }, [user?.id])

  /* ========== 5. Detail Tugas: Siswa & Jawaban (Optimised) ========== */
  const loadDetailTugas = async (tugas, { silent = false } = {}) => {
    if (!tugas) return
    try {
      if (!silent) {
        setIsLoadingDetail(true)
        setSiswaDiKelas([])
        setJawabanTugas([])
      }

      const siswaPromise = supabase
        .from('profiles')
        .select('id, nama, photo_url, kelas, role')
        .eq('role', 'siswa')
        .eq('kelas', tugas.kelas)
        .order('nama')

      const jawabanPromise = supabase
        .from('tugas_jawaban')
        .select(
          'id, tugas_id, user_id, file_url, link_url, nilai, status, profiles(nama, photo_url)'
        )
        .eq('tugas_id', tugas.id)

      const [
        { data: siswaData, error: siswaError },
        { data: jawabanData, error: jawabanError }
      ] = await Promise.all([siswaPromise, jawabanPromise])

      if (siswaError) throw siswaError
      if (jawabanError) throw jawabanError

      setSiswaDiKelas(siswaData || [])

      const formattedJawaban =
        jawabanData?.map((j) => ({
          ...j,
          nama: j.profiles?.nama,
          photo_url: j.profiles?.photo_url,
          uid: j.user_id
        })) || []

      setJawabanTugas(formattedJawaban)

      setNilaiInput((prev) => {
        const next = { ...prev }
        formattedJawaban.forEach((j) => {
          if (j.nilai != null && next[j.user_id] === undefined) {
            next[j.user_id] = j.nilai.toString()
          }
        })
        return next
      })
    } catch (error) {
      console.error('Error loading detail tugas:', error)
      pushToast('error', 'Gagal memuat detail tugas')
    } finally {
      if (!silent) {
        setIsLoadingDetail(false)
      }
    }
  }

  useEffect(() => {
    if (selectedTugas && !isEditingTugas) {
      loadDetailTugas(selectedTugas)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTugas, isEditingTugas])

  /* ========== 5b. Realtime jawaban tugas (Supabase Realtime) ========== */
  useEffect(() => {
    if (!user?.id) return

    const channel = supabase
      .channel(`tugas_jawaban_guru_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tugas_jawaban'
        },
        (payload) => {
          console.log('Realtime tugas_jawaban:', payload)

          // Update panel "Tugas Perlu Dinilai"
          loadTugasPerluDinilai()

          // Jika overlay tugas ini sedang terbuka, refresh detail secara "silent"
          if (selectedTugas) {
            const changedTugasId =
              (payload.new && payload.new.tugas_id) ||
              (payload.old && payload.old.tugas_id)
            if (changedTugasId === selectedTugas.id) {
              loadDetailTugas(selectedTugas, { silent: true })
            }
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, selectedTugas])

  /* ========== 6. Derivasi status siswa ========== */
  const { siswaDinilai, siswaDikerjakan, siswaBelum } = useMemo(() => {
    const siswaDinilai = siswaDiKelas
      .filter((s) => {
        const jawaban = jawabanTugas.find((j) => j.user_id === s.id)
        return jawaban?.nilai != null
      })
      .map((s) => ({
        ...s,
        jawaban: jawabanTugas.find((j) => j.user_id === s.id)
      }))

    const siswaDikerjakan = siswaDiKelas
      .filter((s) => {
        const jawaban = jawabanTugas.find((j) => j.user_id === s.id)
        return jawaban && jawaban.nilai == null
      })
      .map((s) => ({
        ...s,
        jawaban: jawabanTugas.find((j) => j.user_id === s.id)
      }))

    const siswaBelum = siswaDiKelas.filter(
      (s) => !jawabanTugas.find((j) => j.user_id === s.id)
    )

    return { siswaDinilai, siswaDikerjakan, siswaBelum }
  }, [siswaDiKelas, jawabanTugas])

  /* ========== 7. File Upload Handlers dengan Kompresi ========== */
  const handleFileUpload = async (files, mode = 'create') => {
    if (!files?.length || !user?.id) return

    const file = files[0]
    console.log(
      'File dipilih untuk upload:',
      file.name,
      formatFileSize(file.size)
    )

    try {
      setIsUploadingFile(true)
      setCompressionProgress('Mengkompresi file...')

      const compressedFile = await compressFileBeforeUpload(file)

      console.log(
        'File berhasil dikompresi:',
        compressedFile.name,
        formatFileSize(compressedFile.size)
      )

      const currentFileUrl =
        mode === 'edit' ? editForm?.file_url : form.file_url
      if (currentFileUrl) {
        console.log('Menghapus file lama...')
        await deleteFileFromStorage(currentFileUrl)
      }

      const fileExt = compressedFile.name.split('.').pop()
      const fileNameUpload = `${user.id}-${Date.now()}.${fileExt}`
      const filePath = `tugas_lampiran/${fileNameUpload}`

      console.log('Mengupload file ke:', filePath)

      const { error: uploadError } = await supabase.storage
        .from(ASSIGNMENT_BUCKET)
        .upload(filePath, compressedFile, {
          upsert: true,
          cacheControl: '3600'
        })

      if (uploadError) {
        console.error('Upload error:', uploadError)
        throw new Error('Gagal mengupload file: ' + uploadError.message)
      }

      const {
        data: { publicUrl }
      } = supabase.storage.from(ASSIGNMENT_BUCKET).createSignedUrl(filePath)

      const sizeLabel = formatFileSize(compressedFile.size)
      setCompressionProgress(null)

      if (mode === 'edit') {
        setEditForm((prev) => ({ ...prev, file_url: publicUrl }))
        setUploadedFileSizeEdit(sizeLabel)
        setEditExistingFileSize(sizeLabel)
      } else {
        setForm((prev) => ({ ...prev, file_url: publicUrl }))
        setUploadedFileSizeCreate(sizeLabel)
      }

      pushToast(
        'success',
        `File berhasil diupload (${formatFileSize(compressedFile.size)})`
      )
    } catch (error) {
      console.error('Upload error:', error)
      setCompressionProgress(null)
      pushToast('error', `Gagal mengupload file: ${error.message}`)
    } finally {
      setIsUploadingFile(false)
    }
  }

  const handleEditFileUpload = async (files) =>
    await handleFileUpload(files, 'edit')

  /* ========== 7b. Ambil ukuran file lama saat edit ========== */
  useEffect(() => {
    let cancelled = false

    const fetchOldSize = async () => {
      if (!isEditingTugas || !editForm?.file_url) {
        setEditExistingFileSize('')
        setUploadedFileSizeEdit('')
        return
      }
      try {
        const res = await fetch(editForm.file_url)
        if (!res.ok) return
        const blob = await res.blob()
        if (!cancelled) {
          setEditExistingFileSize(formatFileSize(blob.size))
        }
      } catch (err) {
        console.error('Gagal mengambil ukuran file lampiran:', err)
      }
    }

    fetchOldSize()

    return () => {
      cancelled = true
    }
  }, [isEditingTugas, editForm?.file_url])

  /* ========== 8. Render File ========== */
  const renderFile = (url, text, fileSize = '') => {
    if (!url) return null
    const handlePreview = (e) => {
      e.preventDefault()
      e.stopPropagation()
      setPreviewFile(url)
    }
    try {
      const fileExtension = url.split('.').pop().toLowerCase()
      const isImage = ['jpeg', 'jpg', 'gif', 'png', 'webp', 'bmp'].includes(
        fileExtension
      )
      const icon = isImage ? '🖼️' : '📄'
      return (
        <button
          onClick={handlePreview}
          className="inline-flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg text-sm font-medium hover:from-blue-600 hover:to-blue-700 transition-all shadow-md"
        >
          <span className="text-base">{icon}</span>
          <span>
            {text}
            {fileSize ? ` (${fileSize})` : ''}
          </span>
          <span className="opacity-80 text-blue-100 text-xs ml-1">
            👁️ Preview
          </span>
        </button>
      )
    } catch {
      return null
    }
  }

  /* ========== 9. Tambah Tugas ========== */
  const tambahTugas = async () => {
    if (!kelas || !selectedMapel || !form.judul || !form.deadline)
      return pushToast('error', 'Lengkapi data (Kelas, Mapel, Judul, Deadline)')
    try {
      setLoading(true)
      const payload = {
        kelas,
        mapel: selectedMapel,
        judul: form.judul,
        keterangan: form.keterangan,
        deadline: new Date(form.deadline).toISOString(),
        file_url: form.file_url,
        created_by: user.id
      }
      const { error } = await supabase.from('tugas').insert(payload)
      if (error) throw error
      pushToast('success', 'Tugas berhasil ditambahkan')
      setForm({
        judul: '',
        keterangan: '',
        deadline: getNowDateTimeLocal(),
        file_url: ''
      })
      setUploadedFileSizeCreate('')
      loadTugas()
      loadTugasPerluDinilai()
    } catch (error) {
      console.error('Error adding tugas:', error)
      pushToast('error', `Gagal menambahkan tugas: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  /* ========== 10. Simpan Nilai (validasi 0–100) ========== */
  const simpanNilai = async (userId) => {
    if (!selectedTugas) return
    const nilai = nilaiInput[userId]
    if (nilai === undefined || nilai === '')
      return pushToast('error', 'Masukkan nilai terlebih dahulu')
    const parsed = parseInt(nilai, 10)
    if (isNaN(parsed) || parsed < 0 || parsed > 100)
      return pushToast('error', 'Nilai harus antara 0-100')

    try {
      setLoading(true)
      const existingJawaban = jawabanTugas.find((j) => j.user_id === userId)
      if (existingJawaban) {
        const { error } = await supabase
          .from('tugas_jawaban')
          .update({ nilai: parsed, status: 'dinilai' })
          .eq('id', existingJawaban.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('tugas_jawaban').insert({
          tugas_id: selectedTugas.id,
          user_id: userId,
          nilai: parsed,
          status: 'dinilai'
        })
        if (error) throw error
      }
      pushToast('success', 'Nilai berhasil disimpan')
      await loadDetailTugas(selectedTugas, { silent: true })
      await loadTugasPerluDinilai()
      loadTugas()
    } catch (error) {
      console.error('Error saving nilai:', error)
      pushToast('error', `Gagal menyimpan nilai: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  /* ========== 11. Edit & Hapus Tugas ========== */
  const openEditTugas = () => {
    if (!selectedTugas) return
    setEditForm({
      id: selectedTugas.id,
      kelas: selectedTugas.kelas,
      mapel: selectedTugas.mapel,
      judul: selectedTugas.judul,
      keterangan: selectedTugas.keterangan || '',
      deadline: selectedTugas.deadline
        ? selectedTugas.deadline.slice(0, 16)
        : getNowDateTimeLocal(),
      file_url: selectedTugas.file_url || ''
    })
    setIsEditingTugas(true)
    setUploadedFileSizeEdit('')
    setEditExistingFileSize('')
  }

  const simpanEditTugas = async () => {
    if (!editForm) return
    try {
      setLoading(true)
      const payload = {
        judul: editForm.judul,
        keterangan: editForm.keterangan,
        deadline: new Date(editForm.deadline).toISOString(),
        file_url: editForm.file_url
      }
      const { error } = await supabase
        .from('tugas')
        .update(payload)
        .eq('id', editForm.id)
      if (error) throw error
      pushToast('success', 'Tugas berhasil diperbarui')
      setSelectedTugas((prev) => ({ ...prev, ...payload }))
      setIsEditingTugas(false)
      setEditForm(null)
      setUploadedFileSizeEdit('')
      setEditExistingFileSize('')
      loadTugas()
    } catch (error) {
      console.error('Error updating tugas:', error)
      pushToast('error', `Gagal memperbarui tugas: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const hapusTugas = async (tugasId, fileUrl) => {
    if (!confirm('Apakah Anda yakin ingin menghapus tugas ini?')) return
    try {
      setLoading(true)
      if (fileUrl) await deleteFileFromStorage(fileUrl)
      const { error } = await supabase.from('tugas').delete().eq('id', tugasId)
      if (error) throw error
      pushToast('success', 'Tugas berhasil dihapus')
      setSelectedTugas(null)
      setIsEditingTugas(false)
      setEditForm(null)
      setUploadedFileSizeEdit('')
      setEditExistingFileSize('')
      loadTugas()
      loadTugasPerluDinilai()
    } catch (error) {
      console.error('Error deleting tugas:', error)
      pushToast('error', `Gagal menghapus tugas: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  /* ========== 12. Helper Render Tabel Siswa ========== */
  const renderTabelSiswa = (siswaList, type) => {
    const getTypeInfo = () => {
      switch (type) {
        case 'dinilai':
          return {
            title: '✅ Sudah Dinilai',
            bgColor: 'bg-green-50',
            borderColor: 'border-green-200',
            textColor: 'text-green-800',
            icon: '✅'
          }
        case 'dikerjakan':
          return {
            title: '📝 Menunggu Dinilai',
            bgColor: 'bg-yellow-50',
            borderColor: 'border-yellow-200',
            textColor: 'text-yellow-800',
            icon: '📝'
          }
        case 'belum':
          return {
            title: '⏳ Belum Mengerjakan',
            bgColor: 'bg-red-50',
            borderColor: 'border-red-200',
            textColor: 'text-red-800',
            icon: '⏳'
          }
        default:
          return {}
      }
    }
    const typeInfo = getTypeInfo()

    return (
      <div
        className={`rounded-xl border ${typeInfo.borderColor} ${typeInfo.bgColor} p-4`}
      >
        <div className="flex items-center justify-between mb-4">
          <h4
            className={`font-bold text-lg ${typeInfo.textColor} flex items-center gap-2`}
          >
            <span>{typeInfo.icon}</span>
            <span>{typeInfo.title}</span>
          </h4>
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium ${typeInfo.bgColor} ${typeInfo.textColor} border ${typeInfo.borderColor}`}
          >
            {siswaList.length} siswa
          </span>
        </div>

        {siswaList.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-2">🎉</div>
            <p className={typeInfo.textColor}>Tidak ada data</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-2 font-semibold text-slate-700">
                    Siswa
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700">
                    Status
                  </th>
                  {type !== 'belum' && (
                    <th className="text-left py-3 px-2 font-semibold text-slate-700">
                      Jawaban
                    </th>
                  )}
                  {type === 'dinilai' && (
                    <th className="text-left py-3 px-2 font-semibold text-slate-700">
                      Nilai
                    </th>
                  )}
                  {type === 'dikerjakan' && (
                    <th className="text-left py-3 px-2 font-semibold text-slate-700">
                      Aksi
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {siswaList.map((siswa) => (
                  <tr
                    key={siswa.id}
                    className="border-b border-slate-100 hover:bg-white/50 transition-colors"
                  >
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex-shrink-0">
                          {siswa.photo_url ? (
                            <img
                              src={siswa.photo_url}
                              alt={siswa.nama}
                              className="w-10 h-10 rounded-full object-cover border-2 border-slate-200"
                            />
                          ) : (
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                              {initials(siswa.nama)}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-slate-800 truncate">
                            {siswa.nama}
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            {siswa.kelas}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      {type === 'dinilai' && (
                        <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium whitespace-nowrap">
                          ✅ Dinilai
                        </span>
                      )}
                      {type === 'dikerjakan' && (
                        <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium whitespace-nowrap">
                          📝 Menunggu
                        </span>
                      )}
                      {type === 'belum' && (
                        <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium whitespace-nowrap">
                          ⏳ Belum
                        </span>
                      )}
                    </td>
                    {type !== 'belum' && (
                      <td className="py-3 px-2">
                        <div className="flex flex-wrap gap-1">
                          {siswa.jawaban?.file_url && (
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewFile(siswa.jawaban.file_url)
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200 transition-colors whitespace-nowrap"
                            >
                              📎 File
                            </button>
                          )}
                          {siswa.jawaban?.link_url && (
                            // ⬇️ SEKARANG LINK DIBUKA DI OVERLAY (BUKAN TAB BARU)
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewFile(siswa.jawaban.link_url)
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs hover:bg-purple-200 transition-colors whitespace-nowrap"
                            >
                              🔗 Link
                            </button>
                          )}
                          {!siswa.jawaban?.file_url &&
                            !siswa.jawaban?.link_url && (
                              <span className="text-slate-500 text-xs">
                                -
                              </span>
                            )}
                        </div>
                      </td>
                    )}
                    {type === 'dinilai' && (
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            inputMode="numeric"
                            className="w-16 px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="0-100"
                            value={nilaiInput[siswa.id] ?? ''}
                            onChange={(e) => {
                              const val = e.target.value
                              if (
                                val === '' ||
                                (!isNaN(parseInt(val, 10)) &&
                                  parseInt(val, 10) >= 0 &&
                                  parseInt(val, 10) <= 100)
                              ) {
                                setNilaiInput((prev) => ({
                                  ...prev,
                                  [siswa.id]: val
                                }))
                              }
                            }}
                          />
                          <button
                            className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation()
                              simpanNilai(siswa.id)
                            }}
                          >
                            💾
                          </button>
                          <span className="text-xs text-slate-500 whitespace-nowrap">
                            Tersimpan:{' '}
                            <span className="font-semibold text-green-700">
                              {siswa.jawaban.nilai}
                            </span>
                          </span>
                        </div>
                      </td>
                    )}
                    {type === 'dikerjakan' && (
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            inputMode="numeric"
                            className="w-16 px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="0-100"
                            value={nilaiInput[siswa.id] ?? ''}
                            onChange={(e) => {
                              const val = e.target.value
                              if (
                                val === '' ||
                                (!isNaN(parseInt(val, 10)) &&
                                  parseInt(val, 10) >= 0 &&
                                  parseInt(val, 10) <= 100)
                              ) {
                                setNilaiInput((prev) => ({
                                  ...prev,
                                  [siswa.id]: val
                                }))
                              }
                            }}
                          />
                          <button
                            className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation()
                              simpanNilai(siswa.id)
                            }}
                          >
                            💾 Simpan
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  /* ========== 13. Render Utama ========== */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-4 sm:p-6">
      <div className="max-w-full mx-auto space-y-6">
        {/* HEADER DASHBOARD */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                <span className="text-2xl text-white">📚</span>
              </div>
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-slate-800 mb-2">
                  Kelola Tugas
                </h1>
                <p className="text-slate-600 text-lg">
                  Buat, atur, dan nilai tugas untuk siswa Anda
                </p>
              </div>
            </div>
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl px-5 py-3 shadow-lg">
              <p className="text-white font-medium text-center">
                <span className="block text-sm opacity-90">Guru Pengampu</span>
                <span className="block text-lg">{profile?.nama}</span>
              </p>
            </div>
          </div>
        </div>

        {/* FORM BUAT TUGAS BARU */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6">
          <h3 className="text-xl font-bold text-slate-800 mb-5 flex items-center gap-3">
            <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
              <span className="text-white text-sm">➕</span>
            </div>
            <span>Buat Tugas Baru</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Kelas
              </label>
              <select
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm"
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
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Mata Pelajaran
              </label>
              <select
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white disabled:opacity-50 text-sm"
                value={selectedMapel}
                onChange={(e) => setSelectedMapel(e.target.value)}
                disabled={!kelas || mapelList.length === 0}
              >
                <option value="">
                  —{' '}
                  {kelas
                    ? mapelList.length > 0
                      ? 'Pilih Mapel'
                      : 'Tidak ada mapel'
                    : 'Pilih kelas terlebih dahulu'}{' '}
                  —
                </option>
                {mapelList.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Judul Tugas
              </label>
              <input
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm"
                value={form.judul}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, judul: e.target.value }))
                }
                placeholder="Judul tugas..."
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Deadline
              </label>
              <input
                type="datetime-local"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm"
                value={form.deadline}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, deadline: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Keterangan Tugas
              </label>
              <textarea
                rows="4"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white resize-none text-sm"
                value={form.keterangan}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, keterangan: e.target.value }))
                }
                placeholder="Tambahkan instruksi pengerjaan tugas..."
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                File Lampiran
              </label>

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
                        <div className="text-sm font-medium text-green-800">
                          File terlampir
                        </div>
                        <div className="text-xs text-green-600">
                          {uploadedFileSizeCreate ||
                            'Ukuran file akan ditampilkan setelah upload'}{' '}
                          • Siap diupload
                        </div>
                      </div>
                    </div>
                    <button
                      className="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-xs hover:bg-red-200 transition-colors font-medium"
                      onClick={async () => {
                        if (form.file_url) {
                          await deleteFileFromStorage(form.file_url)
                          setForm((prev) => ({ ...prev, file_url: '' }))
                          setUploadedFileSizeCreate('')
                        }
                      }}
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              ) : (
                <FileDropzone
                  onFiles={handleFileUpload}
                  accept="*/*"
                  maxSize={10 * 1024 * 1024}
                  label="Seret file lampiran ke sini atau klik untuk memilih"
                />
              )}

              <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-xs font-semibold text-slate-700 mb-2">
                  📋 Batas Ukuran File (Otomatis Dikompresi):
                </p>
                <ul className="text-xs text-slate-600 space-y-1">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                    <span>
                      Gambar (JPEG/PNG): <strong>maks. 70KB</strong>
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                    <span>
                      PDF & Dokumen: <strong>maks. 2MB</strong>
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-orange-500 rounded-full"></span>
                    <span>
                      Presentasi (PPT): <strong>maks. 3MB</strong>
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-purple-500 rounded-full"></span>
                    <span>
                      File lainnya: <strong>maks. 5MB</strong>
                    </span>
                  </li>
                </ul>
                <p className="text-[11px] text-slate-500 mt-2">
                  💡 Jika foto yang akan dikirim lebih dari satu (misalnya banyak
                  halaman), sebaiknya simpan semua foto di Google Drive lalu
                  kirimkan <strong>link-nya saja</strong> di jawaban siswa. Lebih
                  ringan dan tidak membebani server.
                </p>
              </div>
            </div>
          </div>

          <button
            className="w-full mt-6 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-4 px-6 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 text-base shadow-lg"
            onClick={tambahTugas}
            disabled={!kelas || !selectedMapel || !form.judul || !form.deadline}
          >
            <span>💾</span>
            <span>Simpan Tugas Baru</span>
          </button>
        </div>

        <div className="grid xl:grid-cols-4 gap-6">
          {/* SIDEBAR */}
          <div className="xl:col-span-1 space-y-6">
            {/* CARD TUGAS PERLU DINILAI */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-3">
                <div className="w-8 h-8 bg-red-500 rounded-lg flex items-center justify-center">
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
                <div className="text-center py-8">
                  <div className="text-4xl mb-3">🎉</div>
                  <p className="text-slate-600 font-medium">
                    Tidak ada tugas yang perlu dinilai
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tugasPerluDinilai.slice(0, 5).map((item, index) => (
                    <div
                      key={index}
                      className="p-3 border border-slate-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 cursor-pointer transition-all"
                      onClick={() => setSelectedTugas(item.tugas)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-semibold text-slate-800 text-sm line-clamp-2 flex-1">
                          {item.tugas.judul}
                        </h4>
                        <span className="bg-red-100 text-red-700 px-2 py-1 rounded-full text-xs font-medium ml-2 flex-shrink-0">
                          {item.jumlah}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-2">
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                          {item.tugas.mapel}
                        </span>
                        <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">
                          {formatKelasDisplay(item.tugas.kelas)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* CARD STATISTIK GLOBAL */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-3">
                <div className="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center">
                  <span className="text-white text-sm">📊</span>
                </div>
                <span>Statistik</span>
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-700 text-sm">Total Tugas</span>
                  <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded-full text-xs font-medium">
                    {listTugas.length}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-700 text-sm">Perlu Dinilai</span>
                  <span className="bg-red-100 text-red-700 px-2 py-1 rounded-full text-xs font-medium">
                    {tugasPerluDinilai.length}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-700 text-sm">Aktif</span>
                  <span className="bg-green-100 text-green-700 px-2 py-1 rounded-full text-xs font-medium">
                    {listTugas.filter((t) => !t.isExpired).length}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* MAIN CONTENT: DAFTAR TUGAS */}
          <div className="xl:col-span-3">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
                    <span className="text-white">📋</span>
                  </div>
                  <div>
                    <span>Daftar Tugas</span>
                    {selectedKelasFilter && selectedSubject && (
                      <div className="text-sm font-normal text-slate-500 mt-1">
                        {
                          myKelasList.find((k) => k.id === selectedKelasFilter)
                            ?.nama
                        }{' '}
                        • {selectedSubject}
                      </div>
                    )}
                  </div>
                </h2>
                <div className="flex items-center gap-3 justify-end">
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold border border-emerald-200">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Realtime jawaban aktif</span>
                  </span>
                  <button
                    onClick={loadTugas}
                    className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium flex items-center gap-2 text-sm shadow-md"
                  >
                    <span>🔄</span>
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* FILTER */}
              <div className="space-y-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Pilih Kelas
                    </label>
                    <select
                      className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm"
                      value={selectedKelasFilter}
                      onChange={(e) =>
                        setSelectedKelasFilter(e.target.value || '')
                      }
                    >
                      <option value="">— Pilih Kelas —</option>
                      {myKelasList.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.nama}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Status Tugas
                    </label>
                    <select
                      className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm"
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                    >
                      <option value="all">Semua Status</option>
                      <option value="active">Aktif</option>
                      <option value="expired">Kadaluarsa</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Rentang Waktu
                    </label>
                    <select
                      className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm"
                      value={timeRange}
                      onChange={(e) => setTimeRange(e.target.value)}
                    >
                      <option value="week">1 Minggu Terakhir</option>
                      <option value="all">12 Bulan Terakhir</option>
                      <option value="custom_months">Pilih Beberapa Bulan</option>
                    </select>
                  </div>
                </div>

                {timeRange === 'custom_months' && (
                  <div className="mt-1">
                    <p className="text-xs font-semibold text-slate-700 mb-2">
                      Filter berdasarkan bulan (bisa pilih lebih dari satu)
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {monthOptions.map((m) => {
                        const isActive = selectedMonths.includes(m.value)
                        return (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => {
                              setSelectedMonths((prev) =>
                                prev.includes(m.value)
                                  ? prev.filter((v) => v !== m.value)
                                  : [...prev, m.value]
                              )
                            }}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                              isActive
                                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-white hover:border-blue-300'
                            }`}
                          >
                            {m.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {selectedKelasFilter && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">
                      Mata Pelajaran di Kelas{' '}
                      {
                        myKelasList.find((k) => k.id === selectedKelasFilter)
                          ?.nama
                      }
                    </h3>
                    {mapelCards.length > 0 ? (
                      <div className="flex gap-2 overflow-x-auto pb-2">
                        {mapelCards.map(({ mapel }) => {
                          const isActive = selectedSubject === mapel
                          return (
                            <button
                              key={mapel}
                              onClick={() => setSelectedSubject(mapel)}
                              className={`min-w-[140px] px-4 py-3 rounded-xl border text-left shadow-sm transition-all ${
                                isActive
                                  ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white border-blue-600 shadow-lg scale-[1.02]'
                                  : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-white hover:border-blue-300'
                              }`}
                            >
                              <div className="text-xs uppercase tracking-wide opacity-80 mb-1">
                                Mapel
                              </div>
                              <div className="font-semibold text-sm truncate">
                                {mapel}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-sm text-slate-500 text-center">
                        Tidak ada mata pelajaran yang diampu di kelas ini.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* LIST TUGAS (dengan statistik + progress bar) */}
              {listTugas.length > 0 ? (
                <div className="space-y-4">
                  {listTugas.map((tugas) => {
                    const stats = tugas.stats
                    let total = 0
                    let sudah = 0
                    let dikerjakan = 0
                    let percentSudah = 0
                    let percentDikerjakan = 0
                    let widthSudah = 0
                    let widthBelumDinilai = 0
                    let widthBelum = 0

                    if (stats) {
                      total = stats.total_siswa || 0
                      sudah = stats.sudah || 0
                      dikerjakan = (stats.sudah || 0) + (stats.belum_dinilai || 0)
                      percentSudah = total ? (sudah / total) * 100 : 0
                      percentDikerjakan = total ? (dikerjakan / total) * 100 : 0

                      widthSudah = Math.min(100, Math.max(0, percentSudah))
                      widthBelumDinilai = Math.min(
                        100,
                        Math.max(0, percentDikerjakan - percentSudah)
                      )
                      widthBelum = Math.max(
                        0,
                        100 - (widthSudah + widthBelumDinilai)
                      )
                    }

                    return (
                      <div
                        key={tugas.id}
                        className={`p-5 rounded-xl border transition-all ${
                          selectedTugas?.id === tugas.id
                            ? 'ring-2 ring-blue-500 bg-blue-50 border-blue-200 shadow-md'
                            : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-md'
                        } ${tugas.isExpired ? 'opacity-70' : ''}`}
                      >
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex-1">
                            <div className="flex items-start gap-4">
                              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
                                <span className="text-white text-lg">📝</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between mb-2">
                                  <h3 className="font-bold text-slate-800 text-xl truncate">
                                    {tugas.judul}
                                  </h3>
                                  {tugas.isExpired && (
                                    <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-medium ml-2 flex-shrink-0">
                                      ⏰ Kadaluarsa
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-2 mb-3">
                                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-medium">
                                    🏫 {tugas.kelasDisplay}
                                  </span>
                                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-lg text-xs font-medium">
                                    📖 {tugas.mapel}
                                  </span>
                                </div>

                                {stats && (
                                  <>
                                    <div className="flex flex-wrap gap-3 mb-2 text-sm">
                                      <div className="flex items-center gap-1 px-2 py-1 bg-green-50 border border-green-200 rounded-md text-green-800">
                                        <span className="text-xs">
                                          ✅ Sudah Dinilai:
                                        </span>
                                        <span className="font-bold">
                                          {stats.sudah}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1 px-2 py-1 bg-yellow-50 border border-yellow-200 rounded-md text-yellow-800">
                                        <span className="text-xs">
                                          📝 Belum Dinilai:
                                        </span>
                                        <span className="font-bold">
                                          {stats.belum_dinilai}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1 px-2 py-1 bg-red-50 border border-red-200 rounded-md text-red-800">
                                        <span className="text-xs">
                                          ⏳ Belum Mengerjakan:
                                        </span>
                                        <span className="font-bold">
                                          {stats.belum_mengerjakan}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="mb-3">
                                      <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                                        <span>
                                          Progres penilaian:{' '}
                                          <span className="font-semibold text-slate-700">
                                            {sudah}/{total}
                                          </span>{' '}
                                          siswa sudah dinilai
                                        </span>
                                        <span className="font-medium text-slate-600">
                                          {Math.round(percentDikerjakan || 0)}%
                                          {' '}sudah mengumpulkan
                                        </span>
                                      </div>
                                      <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden flex">
                                        <div
                                          className="h-full bg-green-500"
                                          style={{ width: `${widthSudah}%` }}
                                        />
                                        <div
                                          className="h-full bg-yellow-400"
                                          style={{ width: `${widthBelumDinilai}%` }}
                                        />
                                        <div
                                          className="h-full bg-red-300"
                                          style={{ width: `${widthBelum}%` }}
                                        />
                                      </div>
                                    </div>
                                  </>
                                )}

                                <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                                  <span className="flex items-center gap-1">
                                    📅 Dibuat: {formatDateTime(tugas.created_at)}
                                  </span>
                                  {tugas.deadline && (
                                    <span className="flex items-center gap-1">
                                      ⏰ Deadline:{' '}
                                      {formatDateTime(tugas.deadline)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            {tugas.keterangan && (
                              <p className="text-slate-700 text-sm mt-3 pl-16 line-clamp-2">
                                {tugas.keterangan}
                              </p>
                            )}
                            {tugas.file_url && (
                              <div className="flex gap-2 mt-3 pl-16">
                                {renderFile(tugas.file_url, 'Lampiran Tugas')}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col gap-2 flex-shrink-0">
                            <button
                              onClick={() => setSelectedTugas(tugas)}
                              className={`px-4 py-2 rounded-xl font-medium text-sm flex items-center gap-2 transition-all ${
                                selectedTugas?.id === tugas.id
                                  ? 'bg-blue-600 text-white shadow-md'
                                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                              }`}
                            >
                              <span>👁️</span>
                              <span>Detail</span>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                hapusTugas(tugas.id, tugas.file_url)
                              }}
                              className="px-4 py-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all flex items-center gap-2 font-medium text-sm"
                            >
                              <span>🗑️</span>
                              <span>Hapus</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-16 text-slate-500">
                  <div className="text-7xl mb-6">📝</div>
                  <p className="font-medium text-xl mb-2">Belum ada tugas</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* OVERLAY DETAIL TUGAS */}
      {selectedTugas && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedTugas(null)
              setIsEditingTugas(false)
              setEditForm(null)
              setUploadedFileSizeEdit('')
              setEditExistingFileSize('')
            }
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[95vh] overflow-hidden flex flex-col">
            {/* Header Overlay */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 text-white flex-shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 bg-white bg-opacity-20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <span className="text-xl">📋</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-bold truncate">
                      {selectedTugas.judul}
                    </h2>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="bg-white bg-opacity-20 px-2 py-1 rounded-full text-xs whitespace-nowrap">
                        🏫 {selectedTugas.kelasDisplay}
                      </span>
                      <span className="bg-white bg-opacity-20 px-2 py-1 rounded-full text-xs whitespace-nowrap">
                        📖 {selectedTugas.mapel}
                      </span>
                      {selectedTugas.isExpired && (
                        <span className="bg-red-500 px-2 py-1 rounded-full text-xs whitespace-nowrap">
                          ⏰ Kadaluarsa
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      openEditTugas()
                    }}
                    className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 text-white rounded-lg transition-all flex items-center gap-2 whitespace-nowrap"
                  >
                    <span>✏️</span>
                    <span>Edit</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedTugas(null)
                      setIsEditingTugas(false)
                      setEditForm(null)
                      setUploadedFileSizeEdit('')
                      setEditExistingFileSize('')
                    }}
                    className="w-10 h-10 bg-white bg-opacity-20 hover:bg-opacity-30 text-white rounded-lg transition-all flex items-center justify-center flex-shrink-0"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>

            {/* Content Overlay */}
            <div className="flex-1 overflow-y-auto">
              {isEditingTugas && editForm ? (
                /* MODE EDIT */
                <div className="p-6 space-y-6">
                  <div className="flex items-center gap-2 text-blue-600 mb-2">
                    <span>✏️</span>
                    <h3 className="text-lg font-semibold">Edit Tugas</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Judul Tugas
                      </label>
                      <input
                        name="judul"
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm"
                        value={editForm.judul}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            judul: e.target.value
                          }))
                        }
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Deadline
                      </label>
                      <input
                        type="datetime-local"
                        name="deadline"
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm"
                        value={editForm.deadline}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            deadline: e.target.value
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Keterangan Tugas
                    </label>
                    <textarea
                      rows="4"
                      name="keterangan"
                      className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white resize-none text-sm"
                      value={editForm.keterangan}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          keterangan: e.target.value
                        }))
                      }
                      placeholder="Tambahkan instruksi pengerjaan tugas..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      File Lampiran
                    </label>

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
                        Loading...
                      </div>
                    ) : editForm.file_url ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between p-3 bg-green-50 rounded-xl border border-green-200">
                          <div className="flex items-center gap-3">
                            <span className="text-green-600 text-lg">✅</span>
                            <div>
                              <div className="text-sm font-medium text-green-800">
                                File terlampir
                              </div>
                              <div className="text-xs text-green-600">
                                {uploadedFileSizeEdit ||
                                  editExistingFileSize ||
                                  'Ukuran file sedang diambil...'}
                              </div>
                            </div>
                          </div>
                          <button
                            className="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-xs hover:bg-red-200 transition-colors font-medium"
                            onClick={async (e) => {
                              e.stopPropagation()
                              if (editForm.file_url) {
                                await deleteFileFromStorage(editForm.file_url)
                                setEditForm((prev) => ({
                                  ...prev,
                                  file_url: ''
                                }))
                                setUploadedFileSizeEdit('')
                                setEditExistingFileSize('')
                              }
                            }}
                          >
                            Hapus
                          </button>
                        </div>
                        <div className="text-xs text-slate-500">
                          Jika Anda mengupload file baru, file lama akan diganti.
                        </div>
                      </div>
                    ) : (
                      <FileDropzone
                        onFiles={handleEditFileUpload}
                        accept="*/*"
                        maxSize={10 * 1024 * 1024}
                        label="Seret file lampiran ke sini atau klik untuk memilih"
                      />
                    )}

                    <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <p className="text-xs font-semibold text-slate-700 mb-2">
                        📋 Batas Ukuran File (Otomatis Dikompresi):
                      </p>
                      <ul className="text-xs text-slate-600 space-y-1">
                        <li className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                          <span>
                            Gambar (JPEG/PNG): <strong>maks. 70KB</strong>
                          </span>
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                          <span>
                            PDF & Dokumen: <strong>maks. 2MB</strong>
                          </span>
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-orange-500 rounded-full"></span>
                          <span>
                            Presentasi (PPT): <strong>maks. 3MB</strong>
                          </span>
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-purple-500 rounded-full"></span>
                          <span>
                            File lainnya: <strong>maks. 5MB</strong>
                          </span>
                        </li>
                      </ul>
                      <p className="text-[11px] text-slate-500 mt-2">
                        💡 Jika foto yang akan dikirim lebih dari satu (misalnya
                        banyak halaman), sebaiknya simpan semua foto di Google
                        Drive lalu kirimkan <strong>link-nya saja</strong> di
                        jawaban siswa. Lebih ringan dan tidak membebani server.
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                    <button
                      className="px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors font-medium"
                      onClick={() => {
                        setIsEditingTugas(false)
                        setEditForm(null)
                        setUploadedFileSizeEdit('')
                        setEditExistingFileSize('')
                      }}
                    >
                      Batal
                    </button>
                    <button
                      className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
                      onClick={simpanEditTugas}
                    >
                      <span>💾</span>
                      <span>Simpan Perubahan</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* MODE DETAIL */
                <div className="p-6">
                  {/* Info Tugas Detail */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                    <div className="bg-slate-50 rounded-xl p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                          <span className="text-blue-600">📅</span>
                        </div>
                        <div>
                          <div className="text-sm text-slate-600">Dibuat</div>
                          <div className="font-semibold text-slate-800">
                            {formatDateTime(selectedTugas.created_at)}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                          <span className="text-orange-600">⏰</span>
                        </div>
                        <div>
                          <div className="text-sm text-slate-600">
                            Deadline
                          </div>
                          <div className="font-semibold text-slate-800">
                            {formatDateTime(selectedTugas.deadline)}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                          <span className="text-purple-600">👥</span>
                        </div>
                        <div>
                          <div className="text-sm text-slate-600">
                            Total Siswa
                          </div>
                          <div className="font-semibold text-slate-800">
                            {siswaDiKelas.length} siswa
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  {selectedTugas.keterangan && (
                    <div className="bg-blue-50 rounded-xl p-4 mb-6 border border-blue-200">
                      <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                        <span>📝</span>
                        <span>Keterangan Tugas</span>
                      </h4>
                      <p className="text-slate-700 whitespace-pre-wrap text-sm leading-relaxed">
                        {selectedTugas.keterangan}
                      </p>
                    </div>
                  )}
                  {selectedTugas.file_url && (
                    <div className="mb-6">
                      <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                        <span>📎</span>
                        <span>Lampiran Tugas</span>
                      </h4>
                      <div className="flex gap-2">
                        {renderFile(selectedTugas.file_url, 'File Lampiran')}
                      </div>
                    </div>
                  )}

                  {/* List Siswa & Penilaian */}
                  {isLoadingDetail ? (
                    <div className="text-center py-12 text-slate-500">
                      <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                      <p className="font-medium">Memuat data pengumpulan...</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-4 text-white text-center">
                          <div className="text-2xl font-bold mb-1">
                            {siswaDinilai.length}
                          </div>
                          <div className="text-sm font-medium opacity-90">
                            Sudah Dinilai
                          </div>
                        </div>
                        <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl p-4 text-white text-center">
                          <div className="text-2xl font-bold mb-1">
                            {siswaDikerjakan.length}
                          </div>
                          <div className="text-sm font-medium opacity-90">
                            Menunggu Dinilai
                          </div>
                        </div>
                        <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-4 text-white text-center">
                          <div className="text-2xl font-bold mb-1">
                            {siswaBelum.length}
                          </div>
                          <div className="text-sm font-medium opacity-90">
                            Belum Mengerjakan
                          </div>
                        </div>
                      </div>
                      <div className="space-y-4">
                        {renderTabelSiswa(siswaDinilai, 'dinilai')}
                        {renderTabelSiswa(siswaDikerjakan, 'dikerjakan')}
                        {renderTabelSiswa(siswaBelum, 'belum')}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* FILE / LINK PREVIEW MODAL */}
      {previewFile && (
        <FilePreviewModal
          fileUrl={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  )
}
