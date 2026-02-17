// src/pages/guru/LaporanRekap.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'

// === Dynamic imports (Hanya ExcelJS) ===
let ExcelJS
const loadExcelLibrary = async () => {
  try {
    const excelModule = await import('exceljs')
    ExcelJS = excelModule.default
    return true
  } catch (e) {
    console.error('Error loading ExcelJS:', e)
    return false
  }
}

// ==============================
// ===== HELPERS & UTILS ========
// ==============================

const getKelasDisplayName = (kelasObj) => kelasObj?.nama || kelasObj?.id || ''

const getNamaKelasFromList = (kelasId, kelasList) => {
  const kelas = kelasList.find((k) => k.id === kelasId)
  return getKelasDisplayName(kelas) || kelasId || '—'
}

const normalizeKelasKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')

// Helper untuk mengambil tanggal dari ARRAY bulan yang dipilih
const getDatesInPeriod = (year, selectedMonths) => {
  if (!selectedMonths || selectedMonths.length === 0) return []

  let allDates = []
  // Sort bulan agar urut (01, 02, dst)
  const sortedMonths = [...selectedMonths].sort()

  sortedMonths.forEach((monthStr) => {
    const m = parseInt(monthStr) - 1
    const date = new Date(year, m, 1)
    while (date.getMonth() === m) {
      const y = date.getFullYear()
      const mo = String(date.getMonth() + 1).padStart(2, '0')
      const d = String(date.getDate()).padStart(2, '0')
      allDates.push(`${y}-${mo}-${d}`)
      date.setDate(date.getDate() + 1)
    }
  })
  return allDates
}

const isSunday = (dateString) => {
  const d = new Date(dateString)
  return d.getDay() === 0
}

const getGrade = (v) => {
  if (v === '-' || v === null || v === undefined) return '-'
  const n = Number(v)
  if (Number.isNaN(n)) return '-'
  if (n >= 90) return 'A'
  if (n >= 80) return 'B'
  if (n >= 70) return 'C'
  if (n >= 60) return 'D'
  return 'E'
}

// HELPER WARNA: Hijau (A), Kuning (C), Merah (D/E)
const getColorClass = (val) => {
  if (val === '-' || val === null || val === undefined || val === '') return ''

  // 1. Cek jika input adalah Huruf (Grade A, B, C, D, E)
  if (typeof val === 'string' && isNaN(Number(val))) {
    if (val === 'A')
      return 'bg-green-100 text-green-700 font-bold border border-green-200'
    if (val === 'C')
      return 'bg-yellow-100 text-yellow-800 font-bold border border-yellow-200'
    if (val === 'D' || val === 'E')
      return 'bg-red-100 text-red-700 font-bold border border-red-200'
    return 'text-gray-700' // B atau lainnya standar
  }

  // 2. Cek jika input adalah Angka (Nilai 0-100)
  const n = Number(val)
  if (n >= 90) return 'bg-green-100 text-green-700 font-bold' // A
  if (n >= 80) return 'text-gray-700' // B (Normal)
  if (n >= 70) return 'bg-yellow-100 text-yellow-800 font-bold' // C
  if (n < 70) return 'bg-red-100 text-red-700 font-bold' // D & E

  return ''
}

const bulanList = [
  { value: '01', label: 'Januari' },
  { value: '02', label: 'Februari' },
  { value: '03', label: 'Maret' },
  { value: '04', label: 'April' },
  { value: '05', label: 'Mei' },
  { value: '06', label: 'Juni' },
  { value: '07', label: 'Juli' },
  { value: '08', label: 'Agustus' },
  { value: '09', label: 'September' },
  { value: '10', label: 'Oktober' },
  { value: '11', label: 'November' },
  { value: '12', label: 'Desember' }
]

const KKM_NILAI_TUGAS = 75
const REKAP_WALI_BOBOT = {
  akademik: 80,
  absensi: 20
}
const REKAP_WALI_STATUS_BOBOT = {
  Hadir: 1,
  Izin: 0.8,
  Sakit: 0.8,
  Alpha: 0
}

const round2 = (num) => Math.round(num * 100) / 100

const hitungSkorAbsensiWali = (absensi = {}, totalPertemuanKelas = null) => {
  const hadir = Number(absensi.Hadir || 0)
  const izin = Number(absensi.Izin || 0)
  const sakit = Number(absensi.Sakit || 0)
  const alpha = Number(absensi.Alpha || 0)
  const totalTercatat = hadir + izin + sakit + alpha
  const targetPertemuan =
    Number.isFinite(totalPertemuanKelas) && totalPertemuanKelas > 0
      ? Math.max(totalPertemuanKelas, totalTercatat)
      : totalTercatat

  if (!targetPertemuan) {
    return {
      skorAbsensi: null,
      absensiEfektif: { Hadir: hadir, Izin: izin, Sakit: sakit, Alpha: alpha },
      totalPertemuan: 0
    }
  }

  const alphaEfektif = alpha + Math.max(0, targetPertemuan - totalTercatat)

  const totalBobot =
    hadir * REKAP_WALI_STATUS_BOBOT.Hadir +
    izin * REKAP_WALI_STATUS_BOBOT.Izin +
    sakit * REKAP_WALI_STATUS_BOBOT.Sakit +
    alphaEfektif * REKAP_WALI_STATUS_BOBOT.Alpha

  return {
    skorAbsensi: round2((totalBobot / targetPertemuan) * 100),
    absensiEfektif: {
      Hadir: hadir,
      Izin: izin,
      Sakit: sakit,
      Alpha: alphaEfektif
    },
    totalPertemuan: targetPertemuan
  }
}

const hitungRataAkhirWali = (rataAkademik, skorAbsensi) => {
  const nilaiAkademik =
    typeof rataAkademik === 'number' && !Number.isNaN(rataAkademik)
      ? rataAkademik
      : null
  const nilaiAbsensi =
    typeof skorAbsensi === 'number' && !Number.isNaN(skorAbsensi)
      ? skorAbsensi
      : null

  const totalBobot = REKAP_WALI_BOBOT.akademik + REKAP_WALI_BOBOT.absensi
  if (nilaiAkademik == null && nilaiAbsensi == null) return '-'

  // Untuk wali kelas, siswa tanpa nilai akademik tidak diberikan rata-rata akhir numerik.
  // Mereka tetap diurutkan di bawah siswa yang sudah dinilai (lihat comparator rank).
  if (nilaiAkademik == null) {
    return '-'
  }

  // Jika absensi belum tersedia (mis. belum ada sesi), pakai akademik penuh.
  if (nilaiAbsensi == null) return round2(nilaiAkademik)

  const hasil =
    (nilaiAkademik * REKAP_WALI_BOBOT.akademik +
      nilaiAbsensi * REKAP_WALI_BOBOT.absensi) /
    totalBobot

  return round2(hasil)
}

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  if (value === '-') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const compareNumberDescNullLast = (a, b) => {
  const av = toNumberOrNull(a)
  const bv = toNumberOrNull(b)
  if (av == null && bv == null) return 0
  if (av == null) return 1
  if (bv == null) return -1
  if (bv !== av) return bv - av
  return 0
}

const isSameRankGroup = (a, b) => {
  const nilaiAkademikA = toNumberOrNull(a?.rataAkademik)
  const nilaiAkademikB = toNumberOrNull(b?.rataAkademik)
  const absensiA = toNumberOrNull(a?.skorAbsensi)
  const absensiB = toNumberOrNull(b?.skorAbsensi)
  const alphaA = Number(a?.absensi?.Alpha || 0)
  const alphaB = Number(b?.absensi?.Alpha || 0)
  const hadirA = Number(a?.absensi?.Hadir || 0)
  const hadirB = Number(b?.absensi?.Hadir || 0)
  return (
    nilaiAkademikA === nilaiAkademikB &&
    absensiA === absensiB &&
    alphaA === alphaB &&
    hadirA === hadirB
  )
}

const compareRankWali = (a, b) => {
  // Urutan ranking wali kelas:
  // 1) Rata akademik (utama), 2) Skor absensi, 3) Alpha paling sedikit, 4) Hadir terbanyak
  const byAcademic = compareNumberDescNullLast(a?.rataAkademik, b?.rataAkademik)
  if (byAcademic) return byAcademic

  const byAbsensi = compareNumberDescNullLast(a?.skorAbsensi, b?.skorAbsensi)
  if (byAbsensi) return byAbsensi

  const alphaA = Number(a?.absensi?.Alpha || 0)
  const alphaB = Number(b?.absensi?.Alpha || 0)
  if (alphaA !== alphaB) return alphaA - alphaB

  const hadirA = Number(a?.absensi?.Hadir || 0)
  const hadirB = Number(b?.absensi?.Hadir || 0)
  if (hadirB !== hadirA) return hadirB - hadirA

  return String(a?.nama || '').localeCompare(String(b?.nama || ''), 'id')
}

// ==============================
// ===== MAIN COMPONENT =========
// ==============================
export default function LaporanRekap() {
  const { user } = useAuthStore()
  const { pushToast, setLoading } = useUIStore()

  // -- UI State --
  const [activeTab, setActiveTab] = useState('absensi')
  const [showBulanDropdown, setShowBulanDropdown] = useState(false)
  const dropdownRef = useRef(null)

  // -- Data Filter State --
  const [kelasList, setKelasList] = useState([])
  const [waliKelasList, setWaliKelasList] = useState([])
  const [selectedWaliKelas, setSelectedWaliKelas] = useState('')
  const [jadwalGuru, setJadwalGuru] = useState([])
  const [mapelList, setMapelList] = useState([])

  // -- Selection State (Default Kosong) --
  const [selectedKelas, setSelectedKelas] = useState('')
  const [selectedMapel, setSelectedMapel] = useState('')
  const [selectedBulan, setSelectedBulan] = useState(() => [
    String(new Date().getMonth() + 1).padStart(2, '0')
  ]) // Default: bulan berjalan
  const [tahun, setTahun] = useState(new Date().getFullYear())

  // -- Data Result State --
  const [absensiData, setAbsensiData] = useState(null)
  const [tugasData, setTugasData] = useState(null)
  const [quizData, setQuizData] = useState(null)
  const [rekapWaliData, setRekapWaliData] = useState(null)
  const [editingNilai, setEditingNilai] = useState(null)
  const [excelReady, setExcelReady] = useState(false)
  const [detailSiswaOpen, setDetailSiswaOpen] = useState(false)
  const [detailSiswaLoading, setDetailSiswaLoading] = useState(false)
  const [detailSiswaData, setDetailSiswaData] = useState(null)

  // Pencarian siswa di tab Absensi
  const [searchNama, setSearchNama] = useState('')
  const [searchRekapWali, setSearchRekapWali] = useState('')
  const [searchRekapEskul, setSearchRekapEskul] = useState('')

  // 1. Initial Load (Lib & Click Outside)
  useEffect(() => {
    loadExcelLibrary().then((ok) => setExcelReady(ok))

    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowBulanDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 2. Load Master Data (Jadwal Guru -> Kelas -> Mapel)
  useEffect(() => {
    const load = async () => {
      if (!user?.id) return
      try {
        const { data } = await supabase.from('jadwal').select('*').eq('guru_id', user.id)
        setJadwalGuru(data || [])
      } catch (e) {
        console.error(e)
      }
    }
    load()
  }, [user?.id])

  useEffect(() => {
    const loadWaliKelas = async () => {
      if (!user?.id) return
      try {
        const { data } = await supabase
          .from('kelas_struktur')
          .select('kelas_id')
          .eq('wali_guru_id', user.id)

        const kelasIds = (data || []).map((d) => d.kelas_id).filter(Boolean)
        if (!kelasIds.length) {
          setWaliKelasList([])
          setSelectedWaliKelas('')
          return
        }

        const { data: kelasData } = await supabase
          .from('kelas')
          .select('*')
          .in('id', kelasIds)
          .order('grade')
          .order('suffix')

        const sorted = (kelasData || []).sort((a, b) =>
          getKelasDisplayName(a).localeCompare(getKelasDisplayName(b))
        )
        setWaliKelasList(sorted)
        if (!selectedWaliKelas && sorted.length) setSelectedWaliKelas(sorted[0].id)
      } catch (e) {
        console.error(e)
      }
    }
    loadWaliKelas()
  }, [user?.id, selectedWaliKelas])

  useEffect(() => {
    const load = async () => {
      if (!jadwalGuru.length) {
        setKelasList([])
        setSelectedKelas('')
        return
      }
      try {
        const kelasIds = [...new Set(jadwalGuru.map((j) => j.kelas_id).filter(Boolean))]
        if (!kelasIds.length) {
          setKelasList([])
          return
        }
        const { data } = await supabase
          .from('kelas')
          .select('*')
          .in('id', kelasIds)
          .order('grade')
          .order('suffix')
        const sorted = (data || []).sort((a, b) =>
          getKelasDisplayName(a).localeCompare(getKelasDisplayName(b))
        )
        setKelasList(sorted)
        if (sorted.length && !selectedKelas) setSelectedKelas(sorted[0].id)
      } catch (e) {
        console.error(e)
      }
    }
    load()
  }, [jadwalGuru, selectedKelas])

  useEffect(() => {
    if (!selectedKelas || !jadwalGuru.length) {
      setMapelList([])
      setSelectedMapel('')
      return
    }
    const mapels = jadwalGuru
      .filter((j) => j.kelas_id === selectedKelas && j.mapel)
      .map((j) => j.mapel)
      .filter((v, i, s) => s.indexOf(v) === i)
      .sort()
    setMapelList(mapels)
    if (mapels.length && !selectedMapel) setSelectedMapel(mapels[0])
    else if (!mapels.length) setSelectedMapel('')
  }, [selectedKelas, jadwalGuru, selectedMapel])

  // Toggle Checkbox Bulan
  const handleToggleBulan = (val) => {
    setSelectedBulan((prev) => {
      if (prev.includes(val)) return prev.filter((b) => b !== val)
      return [...prev, val].sort()
    })
  }

  // Shortcut: Bulan ini
  const handleSelectCurrentMonth = () => {
    const now = new Date()
    const monthStr = String(now.getMonth() + 1).padStart(2, '0')
    setTahun(now.getFullYear())
    setSelectedBulan([monthStr])
  }

  // Shortcut: Semua bulan tahun ini
  const handleSelectAllMonths = () => {
    setSelectedBulan(bulanList.map((b) => b.value))
  }

  // Hitung Rata-rata & Grade
  const hitungRataRataDanGrade = (nilaiTugas) => {
    const values = Object.values(nilaiTugas)
      .map((it) => it.nilai)
      .filter(
        (v) =>
          v !== '-' &&
          v !== null &&
          v !== undefined &&
          !Number.isNaN(v)
      )
      .map((v) => Number(v))
    if (!values.length) return { rataRata: '-', grade: '-' }
    const total = values.reduce((s, n) => s + n, 0)
    const rr = Math.round((total / values.length) * 100) / 100
    return { rataRata: rr, grade: getGrade(rr) }
  }

  // ==============================
  // ===== DATA LOADERS ===========
  // ==============================

  const loadRekapAbsensi = useCallback(async () => {
    // Syarat: Kelas, Mapel, dan MINIMAL 1 Bulan dipilih
    if (!selectedKelas || !selectedMapel || selectedBulan.length === 0) {
      setAbsensiData(null)
      return
    }

    try {
      setLoading(true)
      const dateStrings = getDatesInPeriod(tahun, selectedBulan)
      if (dateStrings.length === 0) {
        setAbsensiData(null)
        return
      }

      const { data: siswaData } = await supabase
        .from('profiles')
        .select('id, nama, nis')
        .eq('kelas', selectedKelas)
        .eq('role', 'siswa')
        .order('nama')
      if (!siswaData) throw new Error('Data siswa tidak ditemukan')

      const { data: absData } = await supabase
        .from('absensi')
        .select('*')
        .eq('kelas', selectedKelas)
        .eq('mapel', selectedMapel)
        .gte('tanggal', dateStrings[0])
        .lte('tanggal', dateStrings[dateStrings.length - 1])

      const formatted = siswaData.map((s) => {
        const absS = absData?.filter((a) => a.uid === s.id) || []
        const total = { Hadir: 0, Izin: 0, Sakit: 0, Alpha: 0 }
        const absensiPerTanggal = {}

        dateStrings.forEach((dateStr) => {
          const found = absS.find((a) => a.tanggal === dateStr)
          if (found) {
            absensiPerTanggal[dateStr] = found.status
            if (['Hadir', 'Izin', 'Sakit', 'Alpha'].includes(found.status)) {
              total[found.status]++
            }
          } else {
            absensiPerTanggal[dateStr] = null
          }
        })
        return { id: s.id, nama: s.nama, nis: s.nis, total, absensiPerTanggal }
      })

      const namaBulanTerpilih = selectedBulan
        .map((b) => bulanList.find((bl) => bl.value === b)?.label)
        .join(', ')
      setAbsensiData({
        siswa: formatted,
        dateStrings,
        periode: `${namaBulanTerpilih} ${tahun}`
      })
    } catch (e) {
      console.error(e)
      pushToast('error', 'Gagal memuat absensi')
    } finally {
      setLoading(false)
    }
  }, [selectedKelas, selectedMapel, selectedBulan, tahun, setLoading, pushToast])

  const loadRekapTugas = useCallback(async () => {
    // Syarat: Kelas, Mapel, dan MINIMAL 1 Bulan dipilih
    if (!selectedKelas || !selectedMapel || selectedBulan.length === 0) {
      setTugasData(null)
      return
    }

    try {
      setLoading(true)
      const dateStrings = getDatesInPeriod(tahun, selectedBulan)

      const { data: siswaData } = await supabase
        .from('profiles')
        .select('id, nama, nis')
        .eq('kelas', selectedKelas)
        .eq('role', 'siswa')
        .order('nama')

      const startDate = `${dateStrings[0]}T00:00:00`
      const endDate = `${dateStrings[dateStrings.length - 1]}T23:59:59`

      const { data: tugasList } = await supabase
        .from('tugas')
        .select('*')
        .eq('kelas', selectedKelas)
        .eq('mapel', selectedMapel)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at')

      if (!tugasList) {
        setTugasData(null)
        setLoading(false)
        return
      }

      const tugasIds = tugasList.map((t) => t.id)
      const { data: jawabanList } = await supabase
        .from('tugas_jawaban')
        .select('*')
        .in('tugas_id', tugasIds.length ? tugasIds : [-1])

      const formatted = siswaData.map((s) => {
        const nilaiTugas = {}
        tugasList.forEach((t) => {
          const j = jawabanList?.find((x) => x.user_id === s.id && x.tugas_id === t.id)
          const nilai = j?.nilai ?? '-'
          nilaiTugas[t.id] = { nilai, judul: t.judul, tugas_id: t.id }
        })
        const { rataRata, grade } = hitungRataRataDanGrade(nilaiTugas)
        return { id: s.id, nama: s.nama, nis: s.nis, nilaiTugas, rataRata, grade }
      })

      const namaBulanTerpilih = selectedBulan
        .map((b) => bulanList.find((bl) => b === bl.value)?.label)
        .join(', ')
      setTugasData({
        siswa: formatted,
        tugas: tugasList,
        periode: `${namaBulanTerpilih} ${tahun}`
      })
    } catch (e) {
      console.error(e)
      pushToast('error', 'Gagal memuat tugas')
    } finally {
      setLoading(false)
    }
  }, [selectedKelas, selectedMapel, selectedBulan, tahun, setLoading, pushToast])

  const loadRekapQuiz = useCallback(async () => {
    if (!selectedKelas || !selectedMapel || selectedBulan.length === 0) {
      setQuizData(null)
      return
    }

    try {
      setLoading(true)
      const dateStrings = getDatesInPeriod(tahun, selectedBulan)
      if (!dateStrings.length) {
        setQuizData(null)
        return
      }

      const { data: siswaData } = await supabase
        .from('profiles')
        .select('id, nama, nis')
        .eq('kelas', selectedKelas)
        .eq('role', 'siswa')
        .order('nama')

      const startDate = `${dateStrings[0]}T00:00:00`
      const endDate = `${dateStrings[dateStrings.length - 1]}T23:59:59`

      const { data: quizList } = await supabase
        .from('quizzes')
        .select('*')
        .eq('kelas_id', selectedKelas)
        .eq('mapel', selectedMapel)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at')

      if (!quizList) {
        setQuizData(null)
        setLoading(false)
        return
      }

      const quizIds = quizList.map((q) => q.id)
      const { data: submissionList } = await supabase
        .from('quiz_submissions')
        .select('*')
        .in('quiz_id', quizIds.length ? quizIds : [-1])

      const submissionMap = new Map()
      ;(submissionList || []).forEach((s) => {
        submissionMap.set(`${s.siswa_id}|${s.quiz_id}`, s)
      })

      const formatted = (siswaData || []).map((s) => {
        const nilaiQuiz = {}
        quizList.forEach((q) => {
          const sub = submissionMap.get(`${s.id}|${q.id}`)
          const nilai = sub?.score ?? '-'
          nilaiQuiz[q.id] = { nilai, quiz_id: q.id, nama: q.nama }
        })
        const { rataRata, grade } = hitungRataRataDanGrade(nilaiQuiz)
        return { id: s.id, nama: s.nama, nis: s.nis, nilaiQuiz, rataRata, grade }
      })

      const namaBulanTerpilih = selectedBulan
        .map((b) => bulanList.find((bl) => b === bl.value)?.label)
        .join(', ')

      setQuizData({
        siswa: formatted,
        quizzes: quizList,
        periode: `${namaBulanTerpilih} ${tahun}`
      })
    } catch (e) {
      console.error(e)
      pushToast('error', 'Gagal memuat nilai quiz')
    } finally {
      setLoading(false)
    }
  }, [selectedKelas, selectedMapel, selectedBulan, tahun, setLoading, pushToast])

  const loadRekapWali = useCallback(async () => {
    if (!selectedWaliKelas || selectedBulan.length === 0) {
      setRekapWaliData(null)
      return
    }

    try {
      setLoading(true)
      setRekapWaliData(null)

      // Hard guard: hanya kelas yang memang diwali guru ini
      if (
        Array.isArray(waliKelasList) &&
        waliKelasList.length > 0 &&
        !waliKelasList.some((k) => String(k.id) === String(selectedWaliKelas))
      ) {
        pushToast('error', 'Kelas ini bukan kelas wali Anda')
        return
      }

      const dateStrings = getDatesInPeriod(tahun, selectedBulan)
      if (!dateStrings.length) {
        setRekapWaliData(null)
        return
      }

      const waliKelasNama = getNamaKelasFromList(selectedWaliKelas, waliKelasList)
      const kelasAliasesRaw = Array.from(
        new Set(
          [
            String(selectedWaliKelas || '').trim(),
            String(waliKelasNama || '').trim(),
            String(waliKelasNama || '')
              .trim()
              .replace(/\s+/g, '-'),
            String(waliKelasNama || '')
              .trim()
              .replace(/-/g, ' ')
          ].filter(Boolean)
        )
      )
      const kelasAliasNormSet = new Set(kelasAliasesRaw.map((v) => normalizeKelasKey(v)))

      let siswaQuery = supabase
        .from('profiles')
        .select('id, nama, nis, kelas')
        .eq('role', 'siswa')
        .order('nama')
      if (kelasAliasesRaw.length === 1) {
        siswaQuery = siswaQuery.eq('kelas', kelasAliasesRaw[0])
      } else {
        siswaQuery = siswaQuery.in('kelas', kelasAliasesRaw)
      }
      const { data: siswaRaw, error: siswaErr } = await siswaQuery
      if (siswaErr) throw siswaErr
      const siswaData = (siswaRaw || []).filter((s) =>
        kelasAliasNormSet.has(normalizeKelasKey(s.kelas))
      )

      const startDate = `${dateStrings[0]}T00:00:00`
      const endDate = `${dateStrings[dateStrings.length - 1]}T23:59:59`

      const { data: tugasList } = await supabase
        .from('tugas')
        .select('*')
        .eq('kelas', selectedWaliKelas)
        .gte('created_at', startDate)
        .lte('created_at', endDate)

      const tugasIds = (tugasList || []).map((t) => t.id)
      const { data: jawabanList } = await supabase
        .from('tugas_jawaban')
        .select('*')
        .in('tugas_id', tugasIds.length ? tugasIds : [-1])

      const { data: quizList } = await supabase
        .from('quizzes')
        .select('*')
        .eq('kelas_id', selectedWaliKelas)
        .gte('created_at', startDate)
        .lte('created_at', endDate)

      const quizIds = (quizList || []).map((q) => q.id)
      const { data: submissionList } = await supabase
        .from('quiz_submissions')
        .select('*')
        .in('quiz_id', quizIds.length ? quizIds : [-1])

      const { data: absensiList } = await supabase
        .from('absensi')
        .select('*')
        .eq('kelas', selectedWaliKelas)
        .gte('tanggal', dateStrings[0])
        .lte('tanggal', dateStrings[dateStrings.length - 1])

      const siswaIds = (siswaData || []).map((s) => s.id).filter(Boolean)
      let ekskulAnggotaList = []
      if (siswaIds.length) {
        const { data, error } = await supabase
          .from('ekskul_anggota')
          .select('user_id, ekskul_id')
          .in('user_id', siswaIds)
        if (error) throw error
        ekskulAnggotaList = data || []
      }

      const ekskulIds = Array.from(
        new Set((ekskulAnggotaList || []).map((row) => row.ekskul_id).filter(Boolean))
      )

      let ekskulList = []
      if (ekskulIds.length) {
        const { data, error } = await supabase
          .from('ekskul')
          .select('id, nama')
          .in('id', ekskulIds)
        if (error) throw error
        ekskulList = data || []
      }

      let absensiEskulList = []
      if (siswaIds.length && ekskulIds.length) {
        const { data, error } = await supabase
          .from('absensi_eskul')
          .select('user_id, ekskul_id, status, tanggal')
          .in('user_id', siswaIds)
          .in('ekskul_id', ekskulIds)
          .gte('tanggal', dateStrings[0])
          .lte('tanggal', dateStrings[dateStrings.length - 1])
        if (error) throw error
        absensiEskulList = data || []
      }

      const jawabByKey = new Map()
      ;(jawabanList || []).forEach((j) => {
        jawabByKey.set(`${j.user_id}|${j.tugas_id}`, j)
      })

      const subByKey = new Map()
      ;(submissionList || []).forEach((s) => {
        subByKey.set(`${s.siswa_id}|${s.quiz_id}`, s)
      })

      const absensiByUser = new Map()
      ;(absensiList || []).forEach((a) => {
        const key = a.uid
        if (!absensiByUser.has(key)) {
          absensiByUser.set(key, { Hadir: 0, Izin: 0, Sakit: 0, Alpha: 0 })
        }
        if (absensiByUser.get(key)[a.status] != null) {
          absensiByUser.get(key)[a.status] += 1
        }
      })

      const sesiKelasSet = new Set()
      ;(absensiList || []).forEach((a) => {
        if (!a?.tanggal) return
        sesiKelasSet.add(`${a.tanggal}|${a.mapel || '-'}`)
      })
      const totalPertemuanKelas = sesiKelasSet.size

      const makeEskulStat = () => ({ Hadir: 0, Izin: 0, Sakit: 0, Alpha: 0, total: 0 })
      const namaEskulById = new Map(
        (ekskulList || []).map((e) => [String(e.id), e.nama || String(e.id)])
      )
      const anggotaEskulByUser = new Map()
      ;(ekskulAnggotaList || []).forEach((row) => {
        const uid = String(row.user_id || '')
        const eksId = String(row.ekskul_id || '')
        if (!uid || !eksId) return
        if (!anggotaEskulByUser.has(uid)) anggotaEskulByUser.set(uid, new Set())
        anggotaEskulByUser.get(uid).add(eksId)
      })

      const absensiEskulByPair = new Map()
      ;(absensiEskulList || []).forEach((row) => {
        const uid = String(row.user_id || '')
        const eksId = String(row.ekskul_id || '')
        const status = String(row.status || '')
        if (!uid || !eksId) return
        const key = `${uid}|${eksId}`
        if (!absensiEskulByPair.has(key)) absensiEskulByPair.set(key, makeEskulStat())
        const bucket = absensiEskulByPair.get(key)
        if (bucket[status] != null) {
          bucket[status] += 1
          bucket.total += 1
        }
      })

      const rekapEskulSiswa = (siswaData || []).map((s) => {
        const uid = String(s.id || '')
        const ekskulSet = anggotaEskulByUser.get(uid) || new Set()
        const perEskul = Array.from(ekskulSet)
          .map((ekskulId) => {
            const stats = absensiEskulByPair.get(`${uid}|${ekskulId}`) || makeEskulStat()
            return {
              id: ekskulId,
              nama: namaEskulById.get(ekskulId) || ekskulId,
              Hadir: Number(stats.Hadir || 0),
              Izin: Number(stats.Izin || 0),
              Sakit: Number(stats.Sakit || 0),
              Alpha: Number(stats.Alpha || 0),
              total: Number(stats.total || 0)
            }
          })
          .sort((a, b) => String(a.nama || '').localeCompare(String(b.nama || ''), 'id'))

        const totalAbsensi = perEskul.reduce(
          (acc, item) => ({
            Hadir: acc.Hadir + Number(item.Hadir || 0),
            Izin: acc.Izin + Number(item.Izin || 0),
            Sakit: acc.Sakit + Number(item.Sakit || 0),
            Alpha: acc.Alpha + Number(item.Alpha || 0),
            total: acc.total + Number(item.total || 0)
          }),
          makeEskulStat()
        )

        return {
          id: s.id,
          nama: s.nama,
          nis: s.nis,
          kelas: s.kelas,
          jumlahEkskul: perEskul.length,
          eskulList: perEskul.map((item) => item.nama),
          perEskul,
          totalAbsensi
        }
      })

      const makeEmptyEskulRekap = () => ({
        jumlahEkskul: 0,
        eskulList: [],
        perEskul: [],
        totalAbsensi: makeEskulStat()
      })
      const rekapEskulByUser = new Map(
        rekapEskulSiswa.map((item) => [String(item.id), item])
      )

      const siswaRows = (siswaData || []).map((s) => {
        let totalTugas = 0
        let totalQuiz = 0
        let countScore = 0

        ;(tugasList || []).forEach((t) => {
          const j = jawabByKey.get(`${s.id}|${t.id}`)
          if (j?.nilai != null && j?.nilai !== '-') {
            totalTugas += Number(j.nilai)
            countScore += 1
          }
        })

        ;(quizList || []).forEach((q) => {
          const sub = subByKey.get(`${s.id}|${q.id}`)
          if (sub?.score != null) {
            totalQuiz += Number(sub.score)
            countScore += 1
          }
        })

        const absRaw = absensiByUser.get(s.id) || { Hadir: 0, Izin: 0, Sakit: 0, Alpha: 0 }
        const sesiTercatatRaw =
          Number(absRaw.Hadir || 0) +
          Number(absRaw.Izin || 0) +
          Number(absRaw.Sakit || 0) +
          Number(absRaw.Alpha || 0)
        const { skorAbsensi, absensiEfektif } = hitungSkorAbsensiWali(
          absRaw,
          totalPertemuanKelas
        )
        const abs = absensiEfektif
        const totalNilai = totalTugas + totalQuiz
        const rataAkademik = countScore ? round2(totalNilai / countScore) : null
        const rataRata = hitungRataAkhirWali(rataAkademik, skorAbsensi)

        return {
          id: s.id,
          nama: s.nama,
          nis: s.nis,
          kelas: s.kelas,
          totalTugas,
          totalQuiz,
          totalNilai,
          rataAkademik: rataAkademik ?? '-',
          skorAbsensi: skorAbsensi ?? '-',
          rataRata,
          absensi: abs,
          eskul: rekapEskulByUser.get(String(s.id)) || makeEmptyEskulRekap(),
          audit: {
            tanpaNilaiAkademik: rataAkademik == null,
            sesiTercatat: sesiTercatatRaw,
            sesiTanpaCatatan: Math.max(0, totalPertemuanKelas - sesiTercatatRaw)
          }
        }
      })

      const totalSiswa = (siswaData || []).length
      const siswaTanpaNilaiAkademik = siswaRows.filter((s) => s.audit?.tanpaNilaiAkademik).length
      const siswaDenganNilaiAkademik = Math.max(0, totalSiswa - siswaTanpaNilaiAkademik)
      const siswaTanpaCatatanAbsensi = siswaRows.filter(
        (s) => totalPertemuanKelas > 0 && Number(s.audit?.sesiTercatat || 0) === 0
      ).length
      const totalSesiTargetSiswa = totalPertemuanKelas * totalSiswa
      const totalSesiTercatatSiswa = siswaRows.reduce(
        (sum, s) => sum + Number(s.audit?.sesiTercatat || 0),
        0
      )
      const totalSesiTanpaCatatan = Math.max(0, totalSesiTargetSiswa - totalSesiTercatatSiswa)
      const cakupanAbsensiPersen = totalSesiTargetSiswa
        ? round2((totalSesiTercatatSiswa / totalSesiTargetSiswa) * 100)
        : 0

      const siswaIkutEskul = rekapEskulSiswa.filter((s) => s.jumlahEkskul > 0).length
      const siswaTanpaEskul = Math.max(0, totalSiswa - siswaIkutEskul)
      const totalKeanggotaanEskul = rekapEskulSiswa.reduce(
        (sum, s) => sum + Number(s.jumlahEkskul || 0),
        0
      )
      const totalAbsensiEskul = rekapEskulSiswa.reduce(
        (acc, s) => ({
          Hadir: acc.Hadir + Number(s.totalAbsensi.Hadir || 0),
          Izin: acc.Izin + Number(s.totalAbsensi.Izin || 0),
          Sakit: acc.Sakit + Number(s.totalAbsensi.Sakit || 0),
          Alpha: acc.Alpha + Number(s.totalAbsensi.Alpha || 0),
          total: acc.total + Number(s.totalAbsensi.total || 0)
        }),
        makeEskulStat()
      )

      const sorted = [...siswaRows].sort(compareRankWali)

      const ranked = sorted.reduce((acc, s, idx) => {
        if (idx === 0) {
          acc.push({ ...s, rank: 1 })
          return acc
        }

        const prevSource = sorted[idx - 1]
        const prevRanked = acc[idx - 1]
        const rank = isSameRankGroup(s, prevSource) ? prevRanked.rank : idx + 1
        acc.push({ ...s, rank })
        return acc
      }, [])

      const namaBulanTerpilih = selectedBulan
        .map((b) => bulanList.find((bl) => b === bl.value)?.label)
        .join(', ')

      setRekapWaliData({
        siswa: ranked,
        periode: `${namaBulanTerpilih} ${tahun}`,
        totalTugas: tugasList?.length || 0,
        totalQuiz: quizList?.length || 0,
        totalPertemuanKelas,
        eskul: {
          summary: {
            totalEkskul: ekskulIds.length,
            totalKeanggotaanEskul,
            siswaIkutEskul,
            siswaTanpaEskul,
            totalAbsensi: totalAbsensiEskul
          },
          siswa: rekapEskulSiswa
        },
        audit: {
          totalSiswa,
          siswaDenganNilaiAkademik,
          siswaTanpaNilaiAkademik,
          siswaTanpaCatatanAbsensi,
          totalSesiTargetSiswa,
          totalSesiTercatatSiswa,
          totalSesiTanpaCatatan,
          cakupanAbsensiPersen
        }
      })
    } catch (e) {
      console.error(e)
      pushToast('error', 'Gagal memuat rekap wali kelas')
    } finally {
      setLoading(false)
    }
  }, [selectedWaliKelas, selectedBulan, tahun, waliKelasList, setLoading, pushToast])

  const openDetailSiswaNilaiMapel = useCallback(
    async (siswa) => {
      if (!siswa?.id) return
      if (!selectedWaliKelas || selectedBulan.length === 0) {
        pushToast('error', 'Pilih kelas wali dan periode bulan terlebih dahulu')
        return
      }

      const normalizeMapel = (value) => {
        const raw = String(value || '').trim()
        return raw || 'Tanpa Mapel'
      }

      setDetailSiswaOpen(true)
      setDetailSiswaLoading(true)
      setDetailSiswaData({
        siswa,
        rows: [],
        summary: null
      })

      try {
        const dateStrings = getDatesInPeriod(tahun, selectedBulan)
        if (!dateStrings.length) {
          pushToast('error', 'Periode tidak valid')
          return
        }

        const startDate = `${dateStrings[0]}T00:00:00`
        const endDate = `${dateStrings[dateStrings.length - 1]}T23:59:59`

        const [jadwalRes, tugasRes, quizRes] = await Promise.all([
          supabase.from('jadwal').select('mapel').eq('kelas_id', selectedWaliKelas),
          supabase
            .from('tugas')
            .select('id, mapel')
            .eq('kelas', selectedWaliKelas)
            .gte('created_at', startDate)
            .lte('created_at', endDate),
          supabase
            .from('quizzes')
            .select('id, mapel')
            .eq('kelas_id', selectedWaliKelas)
            .gte('created_at', startDate)
            .lte('created_at', endDate)
        ])

        if (jadwalRes.error) throw jadwalRes.error
        if (tugasRes.error) throw tugasRes.error
        if (quizRes.error) throw quizRes.error

        const jadwalList = jadwalRes.data || []
        const tugasList = tugasRes.data || []
        const quizList = quizRes.data || []

        const tugasIds = tugasList.map((t) => t.id).filter(Boolean)
        const quizIds = quizList.map((q) => q.id).filter(Boolean)

        let jawabanList = []
        if (tugasIds.length) {
          const { data, error } = await supabase
            .from('tugas_jawaban')
            .select('tugas_id, nilai')
            .eq('user_id', siswa.id)
            .in('tugas_id', tugasIds)
          if (error) throw error
          jawabanList = data || []
        }

        let submissionList = []
        if (quizIds.length) {
          const { data, error } = await supabase
            .from('quiz_submissions')
            .select('quiz_id, score')
            .eq('siswa_id', siswa.id)
            .in('quiz_id', quizIds)
          if (error) throw error
          submissionList = data || []
        }

        const mapelSet = new Set()
        jadwalList.forEach((j) => mapelSet.add(normalizeMapel(j?.mapel)))
        tugasList.forEach((t) => mapelSet.add(normalizeMapel(t?.mapel)))
        quizList.forEach((q) => mapelSet.add(normalizeMapel(q?.mapel)))

        const bucketMap = new Map()
        const ensureBucket = (mapel) => {
          if (!bucketMap.has(mapel)) {
            bucketMap.set(mapel, {
              mapel,
              nilaiTugas: 0,
              nilaiQuiz: 0,
              totalNilai: 0,
              jumlahPenilaian: 0,
              jumlahTugasDinilai: 0,
              jumlahQuizDinilai: 0,
              rataAkademik: '-',
              grade: '-'
            })
          }
          return bucketMap.get(mapel)
        }

        Array.from(mapelSet).forEach((mapel) => ensureBucket(mapel))

        const tugasById = new Map(tugasList.map((t) => [t.id, t]))
        ;(jawabanList || []).forEach((jawaban) => {
          const tugas = tugasById.get(jawaban.tugas_id)
          if (!tugas) return
          const nilai = toNumberOrNull(jawaban.nilai)
          if (nilai == null) return

          const mapel = normalizeMapel(tugas.mapel)
          const bucket = ensureBucket(mapel)
          bucket.nilaiTugas = round2(bucket.nilaiTugas + nilai)
          bucket.totalNilai = round2(bucket.totalNilai + nilai)
          bucket.jumlahPenilaian += 1
          bucket.jumlahTugasDinilai += 1
        })

        const quizById = new Map(quizList.map((q) => [q.id, q]))
        ;(submissionList || []).forEach((sub) => {
          const quiz = quizById.get(sub.quiz_id)
          if (!quiz) return
          const nilai = toNumberOrNull(sub.score)
          if (nilai == null) return

          const mapel = normalizeMapel(quiz.mapel)
          const bucket = ensureBucket(mapel)
          bucket.nilaiQuiz = round2(bucket.nilaiQuiz + nilai)
          bucket.totalNilai = round2(bucket.totalNilai + nilai)
          bucket.jumlahPenilaian += 1
          bucket.jumlahQuizDinilai += 1
        })

        const rows = Array.from(bucketMap.values())
          .map((row) => {
            if (row.jumlahPenilaian > 0) {
              const rataAkademik = round2(row.totalNilai / row.jumlahPenilaian)
              return {
                ...row,
                rataAkademik,
                grade: getGrade(rataAkademik)
              }
            }
            return row
          })
          .sort((a, b) => {
            if (b.totalNilai !== a.totalNilai) return b.totalNilai - a.totalNilai
            return String(a.mapel).localeCompare(String(b.mapel), 'id')
          })

        const totalNilai = rows.reduce((sum, r) => sum + Number(r.totalNilai || 0), 0)
        const totalPenilaian = rows.reduce((sum, r) => sum + Number(r.jumlahPenilaian || 0), 0)
        const totalMapel = rows.length
        const mapelDenganNilai = rows.filter((r) => Number(r.jumlahPenilaian || 0) > 0).length
        const mapelTanpaNilai = Math.max(0, totalMapel - mapelDenganNilai)
        const rataKeseluruhan =
          totalPenilaian > 0 ? round2(totalNilai / totalPenilaian) : '-'

        const namaBulanTerpilih = selectedBulan
          .map((b) => bulanList.find((bl) => b === bl.value)?.label)
          .join(', ')

        setDetailSiswaData({
          siswa,
          rows,
          summary: {
            periode: `${namaBulanTerpilih} ${tahun}`,
            kelas: getNamaKelasFromList(selectedWaliKelas, waliKelasList),
            totalMapel,
            mapelDenganNilai,
            mapelTanpaNilai,
            totalPenilaian,
            totalNilai: round2(totalNilai),
            rataKeseluruhan,
            gradeKeseluruhan: getGrade(rataKeseluruhan)
          }
        })
      } catch (error) {
        console.error('Gagal memuat detail nilai siswa per mapel:', error)
        pushToast('error', error?.message || 'Gagal memuat detail siswa')
      } finally {
        setDetailSiswaLoading(false)
      }
    },
    [selectedWaliKelas, selectedBulan, tahun, waliKelasList, pushToast]
  )

  // REALTIME TRIGGER
  useEffect(() => {
    if (selectedKelas && selectedMapel) {
      if (activeTab === 'absensi') loadRekapAbsensi()
      else if (activeTab === 'tugas') loadRekapTugas()
      else if (activeTab === 'quiz') loadRekapQuiz()
    }
    if (activeTab === 'rekap') {
      loadRekapWali()
    }

    if (!selectedKelas || !selectedMapel) {
      setAbsensiData(null)
      setTugasData(null)
      setQuizData(null)
    }
  }, [
    selectedKelas,
    selectedMapel,
    selectedBulan,
    selectedWaliKelas,
    tahun,
    activeTab,
    loadRekapAbsensi,
    loadRekapTugas,
    loadRekapQuiz,
    loadRekapWali
  ])

  // ==============================
  // ===== SUMMARY (RINGKASAN) ====
  // ==============================

  const absensiSummary = useMemo(() => {
    if (!absensiData) return null
    const hariKerja = absensiData.dateStrings.filter((d) => !isSunday(d))
    const totalHariKerja = hariKerja.length
    const totalSiswa = absensiData.siswa.length

    let totalHadir = 0
    let totalIzin = 0
    let totalSakit = 0
    let totalAlpha = 0
    let sumPersenHadir = 0

    absensiData.siswa.forEach((s) => {
      totalHadir += s.total.Hadir || 0
      totalIzin += s.total.Izin || 0
      totalSakit += s.total.Sakit || 0
      totalAlpha += s.total.Alpha || 0
      if (totalHariKerja > 0) {
        const persen = (s.total.Hadir / totalHariKerja) * 100
        sumPersenHadir += persen
      }
    })

    const rataPersenHadir =
      totalSiswa && totalHariKerja
        ? Math.round((sumPersenHadir / totalSiswa) * 10) / 10
        : 0

    return {
      totalHadir,
      totalIzin,
      totalSakit,
      totalAlpha,
      totalHariKerja,
      rataPersenHadir,
      totalSiswa
    }
  }, [absensiData])

  const tugasSummary = useMemo(() => {
    if (!tugasData) return null
    const totalSiswa = tugasData.siswa.length
    let totalNilai = 0
    let countNilai = 0
    let siswaDiBawahKKM = 0

    tugasData.siswa.forEach((s) => {
      if (typeof s.rataRata === 'number' && !Number.isNaN(s.rataRata)) {
        totalNilai += s.rataRata
        countNilai++
        if (s.rataRata < KKM_NILAI_TUGAS) siswaDiBawahKKM++
      }
    })

    const rataNilaiKelas =
      countNilai > 0 ? Math.round((totalNilai / countNilai) * 10) / 10 : 0

    return {
      rataNilaiKelas,
      siswaDiBawahKKM,
      totalSiswa,
      countDinilai: countNilai
    }
  }, [tugasData])

  const quizSummary = useMemo(() => {
    if (!quizData) return null
    const totalSiswa = quizData.siswa.length
    let totalNilai = 0
    let countNilai = 0
    let siswaDiBawahKKM = 0

    quizData.siswa.forEach((s) => {
      if (typeof s.rataRata === 'number' && !Number.isNaN(s.rataRata)) {
        totalNilai += s.rataRata
        countNilai++
        if (s.rataRata < KKM_NILAI_TUGAS) siswaDiBawahKKM++
      }
    })

    const rataNilaiKelas =
      countNilai > 0 ? Math.round((totalNilai / countNilai) * 10) / 10 : 0

    return {
      rataNilaiKelas,
      siswaDiBawahKKM,
      totalSiswa,
      countDinilai: countNilai
    }
  }, [quizData])

  // Filter siswa berdasarkan pencarian nama / NIS
  const filteredAbsensiSiswa = useMemo(() => {
    if (!absensiData) return []
    if (!searchNama.trim()) return absensiData.siswa

    const q = searchNama.toLowerCase()
    return absensiData.siswa.filter((s) => {
      const nama = s.nama?.toLowerCase() || ''
      const nis = s.nis?.toLowerCase() || ''
      return nama.includes(q) || nis.includes(q)
    })
  }, [absensiData, searchNama])

  // Ringkasan cepat jika hanya 1 siswa yang cocok
  const singleStudentAbsensiSummary = useMemo(() => {
    if (!absensiData) return null
    if (!searchNama.trim()) return null
    if (!filteredAbsensiSiswa.length) return null
    if (filteredAbsensiSiswa.length > 1) return null

    const s = filteredAbsensiSiswa[0]
    const hariKerja = absensiData.dateStrings.filter((d) => !isSunday(d))
    const totalHariKerja = hariKerja.length

    const persenHadir =
      totalHariKerja > 0
        ? Math.round((s.total.Hadir / totalHariKerja) * 1000) / 10
        : 0

    return {
      nama: s.nama,
      nis: s.nis,
      totalHadir: s.total.Hadir,
      totalIzin: s.total.Izin,
      totalSakit: s.total.Sakit,
      totalAlpha: s.total.Alpha,
      totalHariKerja,
      persenHadir
    }
  }, [absensiData, filteredAbsensiSiswa, searchNama])

  const filteredRekapWaliSiswa = useMemo(() => {
    if (!rekapWaliData?.siswa) return []
    const q = searchRekapWali.trim().toLowerCase()
    if (!q) return rekapWaliData.siswa

    return rekapWaliData.siswa.filter((s) => {
      const nama = String(s.nama || '').toLowerCase()
      const nis = String(s.nis || '').toLowerCase()
      return nama.includes(q) || nis.includes(q)
    })
  }, [rekapWaliData, searchRekapWali])

  const filteredRekapEskulSiswa = useMemo(() => {
    if (!rekapWaliData?.siswa) return []
    const q = searchRekapEskul.trim().toLowerCase()
    if (!q) return rekapWaliData.siswa

    return rekapWaliData.siswa.filter((s) => {
      const nama = String(s.nama || '').toLowerCase()
      const nis = String(s.nis || '').toLowerCase()
      const daftarEskul = String((s.eskul?.eskulList || []).join(', ')).toLowerCase()
      return nama.includes(q) || nis.includes(q) || daftarEskul.includes(q)
    })
  }, [rekapWaliData, searchRekapEskul])

  // ==============================
  // ===== CRUD & ACTIONS =========
  // ==============================

  const updateNilaiTugas = async (siswaId, tugasId, nilaiBaru) => {
    if (!tugasData) return
    try {
      setLoading(true)
      let nilaiFinal = null
      if (nilaiBaru !== '' && nilaiBaru !== null) {
        const n = Number(nilaiBaru)
        if (Number.isNaN(n) || n < 0 || n > 100) {
          pushToast('error', 'Nilai harus 0–100')
          setLoading(false)
          return
        }
        nilaiFinal = Math.round(n)
      }

      const { data: existing, error: fetchErr } = await supabase
        .from('tugas_jawaban')
        .select('id')
        .eq('user_id', siswaId)
        .eq('tugas_id', tugasId)
        .maybeSingle()
      if (fetchErr) throw fetchErr

      if (existing) {
        const { error } = await supabase
          .from('tugas_jawaban')
          .update({ nilai: nilaiFinal, status: 'dinilai' })
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('tugas_jawaban')
          .insert({ user_id: siswaId, tugas_id: tugasId, nilai: nilaiFinal, status: 'dinilai' })
        if (error) throw error
      }

      // Optimistic Update
      setTugasData((prev) => {
        const siswaBaru = prev.siswa.map((s) => {
          if (s.id !== siswaId) return s
          const nilaiTugas = {
            ...s.nilaiTugas,
            [tugasId]: { ...s.nilaiTugas[tugasId], nilai: nilaiFinal }
          }
          const { rataRata, grade } = hitungRataRataDanGrade(nilaiTugas)
          return { ...s, nilaiTugas, rataRata, grade }
        })
        return { ...prev, siswa: siswaBaru }
      })
      pushToast('success', 'Nilai tersimpan')
      setEditingNilai(null)
    } catch (e) {
      console.error('Error:', e)
      pushToast('error', `Gagal menyimpan: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  // ==============================
  // ===== EXPORT HANDLERS ========
  // ==============================
  const saveBlob = (buffer, filename) => {
    const blob = new Blob(
      [buffer],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }

  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print()
    }
  }

  const exportDetailSiswaMapelToExcel = async () => {
    if (!detailSiswaData?.siswa) {
      pushToast('error', 'Detail siswa belum tersedia')
      return
    }
    if (!excelReady) {
      pushToast('error', 'Library Excel belum siap, coba beberapa detik lagi')
      return
    }

    const rows = detailSiswaData.rows || []
    const summary = detailSiswaData.summary || {}
    const siswa = detailSiswaData.siswa

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Detail Nilai Mapel')

    const borderAll = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }

    const title = ws.addRow([`DETAIL NILAI MATA PELAJARAN - ${siswa.nama || 'Siswa'}`])
    title.font = { bold: true, size: 12 }
    ws.mergeCells(1, 1, 1, 8)
    title.alignment = { horizontal: 'center' }

    ws.addRow([`NIS: ${siswa.nis || '-'}`])
    ws.mergeCells(2, 1, 2, 8)
    ws.addRow([`Kelas: ${summary.kelas || '-'}`])
    ws.mergeCells(3, 1, 3, 8)
    ws.addRow([`Periode: ${summary.periode || '-'}`])
    ws.mergeCells(4, 1, 4, 8)
    ws.addRow([])

    const header = ws.addRow([
      'No',
      'Mata Pelajaran',
      'Total Nilai Tugas',
      'Total Nilai Quiz',
      'Total Nilai',
      'Jumlah Penilaian',
      'Rata Akademik',
      'Grade'
    ])
    header.font = { bold: true }
    header.eachCell((cell) => {
      cell.border = borderAll
      cell.alignment = { horizontal: 'center' }
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD1D5DB' }
      }
    })

    rows.forEach((row, idx) => {
      const excelRow = ws.addRow([
        idx + 1,
        row.mapel,
        row.nilaiTugas,
        row.nilaiQuiz,
        row.totalNilai,
        row.jumlahPenilaian,
        row.rataAkademik === '-' ? null : row.rataAkademik,
        row.grade
      ])
      excelRow.eachCell((cell, col) => {
        cell.border = borderAll
        if (col === 2) cell.alignment = { horizontal: 'left' }
        else cell.alignment = { horizontal: 'center' }
      })
    })

    ws.addRow([])
    const summaryRow = ws.addRow([
      '',
      'TOTAL / RINGKAS',
      '',
      '',
      summary.totalNilai ?? 0,
      summary.totalPenilaian ?? 0,
      summary.rataKeseluruhan === '-' ? null : summary.rataKeseluruhan,
      summary.gradeKeseluruhan || '-'
    ])
    summaryRow.font = { bold: true }
    summaryRow.eachCell((cell, col) => {
      if (!cell.value) return
      cell.border = borderAll
      if (col === 2) cell.alignment = { horizontal: 'left' }
      else cell.alignment = { horizontal: 'center' }
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFF6FF' }
      }
    })

    ws.getColumn(1).width = 6
    ws.getColumn(2).width = 28
    ws.getColumn(3).width = 18
    ws.getColumn(4).width = 18
    ws.getColumn(5).width = 14
    ws.getColumn(6).width = 16
    ws.getColumn(7).width = 14
    ws.getColumn(8).width = 10

    const safeName = String(siswa.nama || 'siswa').replace(/[^a-zA-Z0-9_-]+/g, '_')
    const buf = await wb.xlsx.writeBuffer()
    saveBlob(buf, `Detail_nilai_mapel_${safeName}.xlsx`)
  }

  // === ABSENSI – DETAIL (per hari) ===
  const exportAbsensiToExcel = async () => {
    if (!absensiData) return
    if (!excelReady) {
      pushToast('error', 'Library Excel belum siap, coba beberapa detik lagi')
      return
    }

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Rekap Absensi')

    const fillHeader = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD1D5DB' }
    }
    const fillSunday = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFCACA' }
    }
    const borderAll = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }

    // Tambah +4 karena ada 4 kolom summary (I, S, A, H)
    ws.mergeCells(1, 1, 1, 3 + absensiData.dateStrings.length + 4)
    const t = ws.getCell(1, 1)
    t.value = `REKAP ABSENSI ${selectedMapel} - ${getNamaKelasFromList(selectedKelas, kelasList)}`
    t.font = { bold: true, size: 12 }
    t.alignment = { horizontal: 'center' }

    ws.mergeCells(2, 1, 2, 3 + absensiData.dateStrings.length + 4)
    const sub = ws.getCell(2, 1)
    sub.value = absensiData.periode
    sub.font = { bold: true, size: 10 }
    sub.alignment = { horizontal: 'center' }

    const headers = ['No', 'Nama Siswa', 'NIS']
    absensiData.dateStrings.forEach((ds) =>
      headers.push(parseInt(ds.split('-')[2]))
    )
    // I = Izin, S = Sakit, A = Alpha, H = Hadir
    headers.push('I', 'S', 'A', 'H')

    const r = ws.getRow(3)
    r.values = headers
    r.font = { bold: true }
    r.eachCell((cell, col) => {
      cell.fill = fillHeader
      cell.border = borderAll
      cell.alignment = { horizontal: 'center' }
      if (col > 3 && col <= 3 + absensiData.dateStrings.length) {
        if (isSunday(absensiData.dateStrings[col - 4])) {
          cell.fill = fillSunday
          cell.font = { color: { argb: 'FFFF0000' }, bold: true }
        }
      }
    })

    absensiData.siswa.forEach((s, i) => {
      const rowVals = [i + 1, s.nama, s.nis]
      absensiData.dateStrings.forEach((ds) => {
        const st = s.absensiPerTanggal[ds]
        // Tampilkan status di semua hari (termasuk Minggu)
        rowVals.push(st ? st.charAt(0) : '')
      })
      rowVals.push(s.total.Izin, s.total.Sakit, s.total.Alpha, s.total.Hadir)

      const row = ws.addRow(rowVals)
      row.eachCell((cell, col) => {
        cell.border = borderAll
        cell.alignment = { horizontal: 'center' }
        if (col === 2) cell.alignment = { horizontal: 'left' }
        if (col > 3 && col <= 3 + absensiData.dateStrings.length) {
          if (isSunday(absensiData.dateStrings[col - 4])) cell.fill = fillSunday
        }
      })
    })

    ws.getColumn(1).width = 5
    ws.getColumn(2).width = 30
    ws.getColumn(3).width = 15
    for (let c = 4; c < 4 + absensiData.dateStrings.length; c++) {
      ws.getColumn(c).width = 3
    }

    const buf = await wb.xlsx.writeBuffer()
    saveBlob(buf, `Absensi_${selectedMapel}.xlsx`)
  }

  // === ABSENSI – RINGKAS (No, Nama, Hadir, Izin, Sakit, Alpha) ===
  const exportAbsensiSummaryToExcel = async () => {
    if (!absensiData) return
    if (!excelReady) {
      pushToast('error', 'Library Excel belum siap, coba beberapa detik lagi')
      return
    }

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Rekap HISA')

    const borderAll = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }

    const title = ws.addRow([
      `REKAP ABSENSI (H/I/S/A) – ${selectedMapel} – ${getNamaKelasFromList(
        selectedKelas,
        kelasList
      )}`
    ])
    title.font = { bold: true, size: 12 }
    ws.mergeCells(1, 1, 1, 6)
    title.alignment = { horizontal: 'center' }

    const sub = ws.addRow([absensiData.periode])
    ws.mergeCells(2, 1, 2, 6)
    sub.alignment = { horizontal: 'center' }

    const header = ws.addRow(['No', 'Nama', 'Hadir', 'Izin', 'Sakit', 'Alpha'])
    header.font = { bold: true }
    header.eachCell((cell) => {
      cell.border = borderAll
      cell.alignment = { horizontal: 'center' }
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD1D5DB' }
      }
    })

    absensiData.siswa.forEach((s, i) => {
      const row = ws.addRow([
        i + 1,
        s.nama,
        s.total.Hadir,
        s.total.Izin,
        s.total.Sakit,
        s.total.Alpha
      ])
      row.getCell(2).alignment = { horizontal: 'left' }
      row.eachCell((cell) => {
        cell.border = borderAll
        if (!cell.alignment || !cell.alignment.horizontal) {
          cell.alignment = { horizontal: 'center' }
        }
      })
    })

    ws.getColumn(1).width = 5
    ws.getColumn(2).width = 30
    ws.getColumn(3).width = 10
    ws.getColumn(4).width = 10
    ws.getColumn(5).width = 10
    ws.getColumn(6).width = 10

    const buf = await wb.xlsx.writeBuffer()
    saveBlob(buf, `Absensi_ringkas_${selectedMapel}.xlsx`)
  }

  const exportToGoogleSheets = (type) => {
    let csv = ''
    const sep = ';'

    if (type === 'absensi' && absensiData) {
      const dateHeaders = absensiData.dateStrings
        .map((ds) => parseInt(ds.split('-')[2]))
        .join(sep)
      csv += `No${sep}Nama${sep}NIS${sep}${dateHeaders}${sep}I${sep}S${sep}A${sep}Hadir\n`

      absensiData.siswa.forEach((s, i) => {
        const daily = absensiData.dateStrings
          .map((ds) => {
            const st = s.absensiPerTanggal[ds]
            // Tampilkan status semua hari
            return st ? st.charAt(0) : ''
          })
          .join(sep)
        csv += `${i + 1}${sep}"${s.nama}"${sep}'${s.nis}'${sep}${daily}${sep}${s.total.Izin}${sep}${s.total.Sakit}${sep}${s.total.Alpha}${sep}${s.total.Hadir}\n`
      })
    } else if (type === 'tugas' && tugasData) {
      const tHeads = tugasData.tugas
        .map((_, i) => `T${i + 1}`)
        .join(sep)
      csv += `No${sep}Nama${sep}NIS${sep}${tHeads}${sep}Rata-rata${sep}Grade\n`

      tugasData.siswa.forEach((s, i) => {
        const vals = tugasData.tugas
          .map((t) => s.nilaiTugas[t.id]?.nilai ?? '')
          .join(sep)
        csv += `${i + 1}${sep}"${s.nama}"${sep}'${s.nis}'${sep}${vals}${sep}${s.rataRata}${sep}"${s.grade}"\n`
      })
    } else if (type === 'rekap' && rekapWaliData) {
      csv += `Rank${sep}Nama${sep}NIS${sep}Total Tugas${sep}Total Quiz${sep}Total Nilai${sep}Rata Akademik${sep}Skor Absensi${sep}Rata-rata Akhir${sep}Hadir${sep}Izin${sep}Sakit${sep}Alpha${sep}Jml Eskul${sep}Daftar Eskul${sep}Eskul H${sep}Eskul I${sep}Eskul S${sep}Eskul A${sep}Total Presensi Eskul\n`
      rekapWaliData.siswa.forEach((s) => {
        const daftarEskul = (s.eskul?.eskulList || []).join(', ')
        const safeDaftarEskul = String(daftarEskul || '-').replace(/"/g, '""')
        csv += `${s.rank}${sep}"${s.nama}"${sep}'${s.nis}'${sep}${s.totalTugas}${sep}${s.totalQuiz}${sep}${s.totalNilai}${sep}${s.rataAkademik}${sep}${s.skorAbsensi}${sep}${s.rataRata}${sep}${s.absensi.Hadir}${sep}${s.absensi.Izin}${sep}${s.absensi.Sakit}${sep}${s.absensi.Alpha}${sep}${s.eskul?.jumlahEkskul || 0}${sep}"${safeDaftarEskul}"${sep}${s.eskul?.totalAbsensi?.Hadir || 0}${sep}${s.eskul?.totalAbsensi?.Izin || 0}${sep}${s.eskul?.totalAbsensi?.Sakit || 0}${sep}${s.eskul?.totalAbsensi?.Alpha || 0}${sep}${s.eskul?.totalAbsensi?.total || 0}\n`
      })
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Rekap_${type}.csv`
    a.click()
  }

  // === TUGAS – DETAIL (per tugas) ===
  const exportTugasToExcel = async () => {
    if (!tugasData) return
    if (!excelReady) {
      pushToast('error', 'Library Excel belum siap, coba beberapa detik lagi')
      return
    }

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Nilai Tugas')

    const headers = ['No', 'Nama', 'NIS']
    tugasData.tugas.forEach((_, i) => headers.push(`T${i + 1}`))
    headers.push('Rata-rata', 'Grade')

    const r = ws.addRow(headers)
    r.font = { bold: true }
    r.eachCell((cell, col) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD1D5DB' }
      }
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
      cell.alignment = { horizontal: 'center' }
      if (col >= 4 && col <= headers.length - 2) ws.getColumn(col).width = 5
    })

    tugasData.siswa.forEach((s, i) => {
      const rowVals = [i + 1, s.nama, s.nis]
      tugasData.tugas.forEach((t) => {
        const v = s.nilaiTugas[t.id]?.nilai
        rowVals.push(v !== null && v !== '-' ? Number(v) : '')
      })
      rowVals.push(s.rataRata, s.grade)
      const row = ws.addRow(rowVals)
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        }
      })
    })

    ws.getColumn(1).width = 5
    ws.getColumn(2).width = 30
    ws.getColumn(3).width = 15

    const buf = await wb.xlsx.writeBuffer()
    saveBlob(buf, `Nilai_${selectedMapel}.xlsx`)
  }

  const exportRekapWaliToExcel = async () => {
    if (!rekapWaliData) return
    if (!excelReady) {
      pushToast('error', 'Library Excel belum siap, coba beberapa detik lagi')
      return
    }

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Rekap Wali Kelas')

    const headers = [
      'Rank',
      'Nama',
      'NIS',
      'Total Tugas',
      'Total Quiz',
      'Total Nilai',
      'Rata Akademik',
      'Skor Absensi',
      'Rata-rata Akhir',
      'Hadir',
      'Izin',
      'Sakit',
      'Alpha',
      'Jml Eskul',
      'Daftar Eskul',
      'Eskul H',
      'Eskul I',
      'Eskul S',
      'Eskul A',
      'Total Presensi Eskul'
    ]

    const r = ws.addRow(headers)
    r.font = { bold: true }
    r.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD1D5DB' }
      }
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
      cell.alignment = { horizontal: 'center' }
    })

    rekapWaliData.siswa.forEach((s) => {
      const row = ws.addRow([
        s.rank,
        s.nama,
        s.nis,
        s.totalTugas,
        s.totalQuiz,
        s.totalNilai,
        s.rataAkademik,
        s.skorAbsensi,
        s.rataRata,
        s.absensi.Hadir,
        s.absensi.Izin,
        s.absensi.Sakit,
        s.absensi.Alpha,
        s.eskul?.jumlahEkskul || 0,
        (s.eskul?.eskulList || []).join(', ') || '-',
        s.eskul?.totalAbsensi?.Hadir || 0,
        s.eskul?.totalAbsensi?.Izin || 0,
        s.eskul?.totalAbsensi?.Sakit || 0,
        s.eskul?.totalAbsensi?.Alpha || 0,
        s.eskul?.totalAbsensi?.total || 0
      ])
      row.getCell(2).alignment = { horizontal: 'left' }
      row.getCell(15).alignment = { horizontal: 'left' }
    })

    ws.getColumn(1).width = 6
    ws.getColumn(2).width = 30
    ws.getColumn(3).width = 15
    ws.getColumn(15).width = 34

    const buf = await wb.xlsx.writeBuffer()
    saveBlob(buf, 'Rekap_Wali_Kelas.xlsx')
  }

  // === TUGAS – RINGKAS (No, Nama, Rata-rata, Grade) ===
  const exportTugasSummaryToExcel = async () => {
    if (!tugasData) return
    if (!excelReady) {
      pushToast('error', 'Library Excel belum siap, coba beberapa detik lagi')
      return
    }

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Rekap Nilai')

    const borderAll = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }

    const title = ws.addRow([
      `REKAP NILAI TUGAS – ${selectedMapel} – ${getNamaKelasFromList(
        selectedKelas,
        kelasList
      )}`
    ])
    title.font = { bold: true, size: 12 }
    ws.mergeCells(1, 1, 1, 4)
    title.alignment = { horizontal: 'center' }

    const sub = ws.addRow([tugasData.periode])
    ws.mergeCells(2, 1, 2, 4)
    sub.alignment = { horizontal: 'center' }

    const header = ws.addRow(['No', 'Nama', 'Rata-rata', 'Grade'])
    header.font = { bold: true }
    header.eachCell((cell) => {
      cell.border = borderAll
      cell.alignment = { horizontal: 'center' }
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD1D5DB' }
      }
    })

    tugasData.siswa.forEach((s, i) => {
      const row = ws.addRow([
        i + 1,
        s.nama,
        typeof s.rataRata === 'number' ? s.rataRata : null,
        s.grade
      ])
      row.getCell(2).alignment = { horizontal: 'left' }
      row.eachCell((cell, col) => {
        cell.border = borderAll
        if (col !== 2) {
          cell.alignment = { horizontal: 'center' }
        }
      })
    })

    ws.getColumn(1).width = 5
    ws.getColumn(2).width = 30
    ws.getColumn(3).width = 12
    ws.getColumn(4).width = 10

    const buf = await wb.xlsx.writeBuffer()
    saveBlob(buf, `Nilai_ringkas_${selectedMapel}.xlsx`)
  }

  // === GABUNGAN: Nilai + Absensi (No, Nama, Rata-rata, Grade, Hadir, Izin, Sakit, Alpha) ===
  const exportCombinedSummaryToExcel = async () => {
    if (!tugasData || !absensiData) {
      pushToast(
        'error',
        'Data absensi dan nilai harus sudah dimuat. Buka tab Absensi & Nilai Tugas, lalu muat ulang.'
      )
      return
    }
    if (!excelReady) {
      pushToast('error', 'Library Excel belum siap, coba beberapa detik lagi')
      return
    }

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Nilai+Absensi')

    const borderAll = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }

    ws.mergeCells(1, 1, 1, 8)
    const title = ws.getRow(1)
    title.getCell(1).value =
      `REKAP NILAI + ABSENSI – ${selectedMapel} – ${getNamaKelasFromList(
        selectedKelas,
        kelasList
      )}`
    title.font = { bold: true, size: 12 }
    title.alignment = { horizontal: 'center' }

    const periodeGabungan = absensiData.periode || tugasData.periode
    ws.mergeCells(2, 1, 2, 8)
    const sub = ws.getRow(2)
    sub.getCell(1).value = periodeGabungan
    sub.alignment = { horizontal: 'center' }

    const header = ws.addRow([
      'No',
      'Nama',
      'Rata-rata',
      'Grade',
      'Hadir',
      'Izin',
      'Sakit',
      'Alpha'
    ])
    header.font = { bold: true }
    header.eachCell((cell) => {
      cell.border = borderAll
      cell.alignment = { horizontal: 'center' }
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD1D5DB' }
      }
    })

    const nilaiMap = new Map(
      tugasData.siswa.map((s) => [s.id, { rataRata: s.rataRata, grade: s.grade }])
    )

    absensiData.siswa.forEach((s, i) => {
      const n = nilaiMap.get(s.id)
      const row = ws.addRow([
        i + 1,
        s.nama,
        n && typeof n.rataRata === 'number' ? n.rataRata : null,
        n?.grade ?? '-',
        s.total.Hadir,
        s.total.Izin,
        s.total.Sakit,
        s.total.Alpha
      ])
      row.getCell(2).alignment = { horizontal: 'left' }
      row.eachCell((cell, col) => {
        cell.border = borderAll
        if (col !== 2) {
          cell.alignment = { horizontal: 'center' }
        }
      })
    })

    ws.getColumn(1).width = 5
    ws.getColumn(2).width = 30
    ws.getColumn(3).width = 12
    ws.getColumn(4).width = 10
    ws.getColumn(5).width = 10
    ws.getColumn(6).width = 10
    ws.getColumn(7).width = 10
    ws.getColumn(8).width = 10

    const buf = await wb.xlsx.writeBuffer()
    saveBlob(buf, `Rekap_nilai_absensi_${selectedMapel}.xlsx`)
  }

  // === Export 1 siswa: Absensi + Nilai (Laporan Orang Tua) ===
  const exportSingleStudentReport = async () => {
    if (!singleStudentAbsensiSummary || !absensiData) {
      pushToast('error', 'Pilih satu siswa dulu lewat kolom pencarian.')
      return
    }
    if (!excelReady) {
      pushToast('error', 'Library Excel belum siap, coba beberapa detik lagi')
      return
    }

    const siswaAbs = filteredAbsensiSiswa[0]
    if (!siswaAbs) {
      pushToast('error', 'Data siswa tidak ditemukan.')
      return
    }

    const kelasName = getNamaKelasFromList(selectedKelas, kelasList)
    const mapelName = selectedMapel || ''
    const periode = absensiData.periode

    const wb = new ExcelJS.Workbook()

    // ===== Sheet 1: Absensi =====
    const wsAbs = wb.addWorksheet('Absensi')

    const borderAll = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }

    wsAbs.mergeCells(1, 1, 1, 5)
    const titleAbs = wsAbs.getCell(1, 1)
    titleAbs.value = 'LAPORAN ABSENSI SISWA'
    titleAbs.font = { bold: true, size: 14 }
    titleAbs.alignment = { horizontal: 'center' }

    const metaRows = [
      ['Nama', siswaAbs.nama],
      ['NIS', siswaAbs.nis || '-'],
      ['Kelas', kelasName],
      ['Mapel', mapelName],
      ['Periode', periode]
    ]
    metaRows.forEach((row, idx) => {
      const r = wsAbs.getRow(3 + idx)
      r.getCell(1).value = row[0]
      r.getCell(1).font = { bold: true }
      r.getCell(2).value = row[1]
    })

    const headerRowIndex = 3 + metaRows.length + 1 // setelah meta + 1 baris kosong
    const headerAbs = wsAbs.getRow(headerRowIndex)
    headerAbs.values = ['No', 'Tanggal', 'Status', 'Kode', 'Keterangan']
    headerAbs.font = { bold: true }
    headerAbs.eachCell((cell) => {
      cell.alignment = { horizontal: 'center' }
      cell.border = borderAll
    })

    const kerjaDates = absensiData.dateStrings.filter((d) => !isSunday(d))
    kerjaDates.forEach((ds, i) => {
      const row = wsAbs.getRow(headerRowIndex + 1 + i)
      const st = siswaAbs.absensiPerTanggal[ds]
      let ket = ''
      if (st === 'Hadir') ket = 'Masuk'
      else if (st === 'Izin') ket = 'Izin'
      else if (st === 'Sakit') ket = 'Sakit'
      else if (st === 'Alpha') ket = 'Tidak Hadir'

      row.getCell(1).value = i + 1
      row.getCell(2).value = ds
      row.getCell(3).value = st || '-'
      row.getCell(4).value = st ? st.charAt(0) : ''
      row.getCell(5).value = ket

      row.eachCell((cell) => {
        cell.border = borderAll
        cell.alignment = { horizontal: 'center' }
      })
      row.getCell(2).alignment = { horizontal: 'left' }
    })

    // Ringkasan di bawah tabel
    const summaryRowIndex = headerRowIndex + 2 + kerjaDates.length
    const sumRow = wsAbs.getRow(summaryRowIndex)
    sumRow.getCell(1).value = 'Ringkasan'
    sumRow.getCell(1).font = { bold: true }
    sumRow.getCell(2).value =
      `Hadir: ${singleStudentAbsensiSummary.totalHadir}  | ` +
      `Izin: ${singleStudentAbsensiSummary.totalIzin}  | ` +
      `Sakit: ${singleStudentAbsensiSummary.totalSakit}  | ` +
      `Alpha: ${singleStudentAbsensiSummary.totalAlpha}  | ` +
      `Hari Efektif: ${singleStudentAbsensiSummary.totalHariKerja}  | ` +
      `Persentase Hadir: ${singleStudentAbsensiSummary.persenHadir}%`

    wsAbs.getColumn(1).width = 5
    wsAbs.getColumn(2).width = 15
    wsAbs.getColumn(3).width = 12
    wsAbs.getColumn(4).width = 8
    wsAbs.getColumn(5).width = 20

    // ===== Sheet 2: Nilai Tugas =====
    const wsNilai = wb.addWorksheet('Nilai Tugas')
    wsNilai.mergeCells(1, 1, 1, 5)
    const titleNilai = wsNilai.getCell(1, 1)
    titleNilai.value = 'LAPORAN NILAI TUGAS'
    titleNilai.font = { bold: true, size: 14 }
    titleNilai.alignment = { horizontal: 'center' }

    metaRows.forEach((row, idx) => {
      const r = wsNilai.getRow(3 + idx)
      r.getCell(1).value = row[0]
      r.getCell(1).font = { bold: true }
      r.getCell(2).value = row[1]
    })
    const kkmRow = wsNilai.getRow(3 + metaRows.length)
    kkmRow.getCell(1).value = 'KKM'
    kkmRow.getCell(1).font = { bold: true }
    kkmRow.getCell(2).value = KKM_NILAI_TUGAS

    const siswaNilai =
      tugasData?.siswa?.find((s) => s.id === siswaAbs.id) || null

    if (!tugasData || !tugasData.tugas || tugasData.tugas.length === 0 || !siswaNilai) {
      const infoRow = wsNilai.getRow(3 + metaRows.length + 2)
      infoRow.getCell(1).value =
        'Belum ada data nilai tugas untuk periode ini. Buka tab "Nilai Tugas" lalu muat ulang jika ingin laporan lengkap.'
    } else {
      const headerNilaiIdx = 3 + metaRows.length + 2
      const headerNilai = wsNilai.getRow(headerNilaiIdx)
      headerNilai.values = ['No', 'Judul Tugas', 'Nilai', 'Grade', 'Status']
      headerNilai.font = { bold: true }
      headerNilai.eachCell((cell) => {
        cell.alignment = { horizontal: 'center' }
        cell.border = borderAll
      })

      tugasData.tugas.forEach((t, i) => {
        const row = wsNilai.getRow(headerNilaiIdx + 1 + i)
        const info = siswaNilai.nilaiTugas[t.id]
        const nilai = info?.nilai
        const isAngka =
          nilai !== null &&
          nilai !== undefined &&
          nilai !== '-' &&
          !Number.isNaN(Number(nilai))
        const nAngka = isAngka ? Number(nilai) : null
        const grade = isAngka ? getGrade(nAngka) : '-'
        let status = 'Belum dinilai'
        if (isAngka) {
          status = nAngka >= KKM_NILAI_TUGAS ? 'Lulus' : 'Perlu Remedial'
        }

        row.getCell(1).value = i + 1
        row.getCell(2).value = t.judul
        row.getCell(3).value = isAngka ? nAngka : null
        row.getCell(4).value = grade
        row.getCell(5).value = status

        row.eachCell((cell, col) => {
          cell.border = borderAll
          if (col === 2) {
            cell.alignment = { horizontal: 'left' }
          } else {
            cell.alignment = { horizontal: 'center' }
          }
        })
      })

      // Ringkasan akhir di bawah
      const footerRowIdx = headerNilaiIdx + 2 + tugasData.tugas.length
      const footerRow = wsNilai.getRow(footerRowIdx)
      footerRow.getCell(1).value = 'Ringkasan'
      footerRow.getCell(1).font = { bold: true }
      footerRow.getCell(2).value =
        `Rata-rata: ${siswaNilai.rataRata ?? '-'}  | Grade: ${siswaNilai.grade ?? '-'}`

      wsNilai.getColumn(1).width = 5
      wsNilai.getColumn(2).width = 35
      wsNilai.getColumn(3).width = 10
      wsNilai.getColumn(4).width = 10
      wsNilai.getColumn(5).width = 18
    }

    const buf = await wb.xlsx.writeBuffer()
    const safeName = siswaAbs.nama?.replace(/[^\w\d]+/g, '_') || 'siswa'
    saveBlob(buf, `Laporan_${safeName}_${mapelName || 'mapel'}.xlsx`)
  }

  // ==============================
  // ===== RENDER UI ==============
  // ==============================
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-4 sm:p-6 print:bg-white print:p-0">
      <div className="max-w-full mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6 print:hidden">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                <span className="text-2xl text-white">📊</span>
              </div>
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-slate-800 mb-1">Laporan Guru</h1>
                <p className="text-slate-600 text-base">Rekap absensi, tugas, quiz, dan laporan wali kelas dalam satu panel.</p>
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
              <div className="text-xs text-slate-500">Akun Aktif</div>
              <div className="font-semibold text-slate-800">{user?.email || '-'}</div>
            </div>
          </div>
        </div>

        {/* === CONTROLS === */}
        <div
          className={`bg-white p-6 rounded-2xl shadow-sm border border-slate-200/60 grid grid-cols-1 ${
            activeTab === 'rekap' ? 'md:grid-cols-3' : 'md:grid-cols-4'
          } gap-4 print:hidden`}
        >
          {/* Kelas */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Kelas
            </label>
            <select
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedKelas}
              onChange={(e) => setSelectedKelas(e.target.value)}
            >
              {kelasList.map((k) => (
                <option key={k.id} value={k.id}>
                  {getKelasDisplayName(k)}
                </option>
              ))}
            </select>
          </div>

          {/* Mapel (tidak dipakai untuk tab Rekap Wali Kelas) */}
          {activeTab !== 'rekap' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mapel
              </label>
              <select
                className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm disabled:bg-gray-100 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={selectedMapel}
                onChange={(e) => setSelectedMapel(e.target.value)}
              >
                {mapelList.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Multi-Select Bulan */}
          <div className="relative" ref={dropdownRef}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bulan (Checklist)
            </label>
            <button
              type="button"
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-left bg-white flex justify-between items-center text-sm"
              onClick={() => setShowBulanDropdown(!showBulanDropdown)}
            >
              <span
                className={`block truncate ${
                  selectedBulan.length === 0
                    ? 'text-gray-400'
                    : 'text-gray-900'
                }`}
              >
                {selectedBulan.length === 0
                  ? 'Pilih Bulan...'
                  : `${selectedBulan.length} Bulan Terpilih`}
              </span>
              <svg
                className="w-4 h-4 text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M19 9l-7 7-7-7"
                ></path>
              </svg>
            </button>

            {showBulanDropdown && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                <div className="p-2 space-y-1">
                  {bulanList.map((b) => (
                    <label
                      key={b.value}
                      className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        value={b.value}
                        checked={selectedBulan.includes(b.value)}
                        onChange={() => handleToggleBulan(b.value)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">
                        {b.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Shortcut Bulan */}
            <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSelectCurrentMonth}
                  className="text-xs px-2 py-1 rounded-lg border border-slate-300 text-gray-700 hover:bg-gray-100"
                >
                  Bulan ini
                </button>
                <button
                  type="button"
                  onClick={handleSelectAllMonths}
                  className="text-xs px-2 py-1 rounded-lg border border-slate-300 text-gray-700 hover:bg-gray-100"
                >
                  Semua bulan
                </button>
            </div>
          </div>

          {/* Tombol Refresh */}
          <div className="flex flex-col justify-end">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Aksi
            </label>
            <button
              className="w-full h-[48px] bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-sm"
              onClick={() => {
                if (activeTab === 'absensi') loadRekapAbsensi()
                else if (activeTab === 'tugas') loadRekapTugas()
                else if (activeTab === 'quiz') loadRekapQuiz()
                else if (activeTab === 'rekap') loadRekapWali()
              }}
            >
              <span>🔄</span> Muat Ulang
            </button>
          </div>
        </div>

        {/* === TABS === */}
        <div className="flex flex-wrap gap-1 bg-slate-200 p-1.5 rounded-2xl w-fit print:hidden">
          <button
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
              activeTab === 'absensi'
                ? 'bg-white shadow text-blue-700'
                : 'text-gray-600 hover:bg-slate-300'
            }`}
            onClick={() => setActiveTab('absensi')}
          >
            Absensi
          </button>
          <button
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
              activeTab === 'tugas'
                ? 'bg-white shadow text-blue-700'
                : 'text-gray-600 hover:bg-slate-300'
            }`}
            onClick={() => setActiveTab('tugas')}
          >
            Nilai Tugas
          </button>
          <button
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
              activeTab === 'quiz'
                ? 'bg-white shadow text-blue-700'
                : 'text-gray-600 hover:bg-slate-300'
            }`}
            onClick={() => setActiveTab('quiz')}
          >
            Nilai Quiz
          </button>
          {waliKelasList.length > 0 && (
            <button
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
                activeTab === 'rekap'
                  ? 'bg-white shadow text-blue-700'
                  : 'text-gray-600 hover:bg-slate-300'
              }`}
              onClick={() => setActiveTab('rekap')}
            >
              Rekap Wali Kelas
            </button>
          )}
        </div>

        {/* === EMPTY STATES === */}
        {!absensiData && activeTab === 'absensi' && (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300">
            <p className="text-gray-500">
              Silakan pilih Kelas, Mapel, dan checklist Bulan untuk melihat data absensi.
            </p>
          </div>
        )}
        {!tugasData && activeTab === 'tugas' && (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300">
            <p className="text-gray-500">
              Silakan pilih Kelas, Mapel, dan checklist Bulan untuk melihat data nilai.
            </p>
          </div>
        )}
        {!quizData && activeTab === 'quiz' && (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300">
            <p className="text-gray-500">
              Silakan pilih Kelas, Mapel, dan checklist Bulan untuk melihat nilai quiz.
            </p>
          </div>
        )}
        {!rekapWaliData && activeTab === 'rekap' && (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300">
            <p className="text-gray-500">
              Silakan pilih Bulan untuk melihat rekap wali kelas.
            </p>
          </div>
        )}

        {/* === TABLE ABSENSI === */}
        {activeTab === 'absensi' && absensiData && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-wrap gap-3 justify-between items-center bg-slate-50 print:bg-white">
              <h3 className="font-bold text-gray-700">
                Rekap Absensi – {getNamaKelasFromList(selectedKelas, kelasList)} / {selectedMapel}{' '}
                <span className="text-sm font-normal text-gray-500">
                  ({absensiData.periode})
                </span>
              </h3>
              <div className="flex flex-wrap gap-2 print:hidden">
                <button
                  onClick={exportAbsensiToExcel}
                  className="text-xs bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700"
                >
                  Excel Detail
                </button>
                <button
                  onClick={exportAbsensiSummaryToExcel}
                  className="text-xs bg-emerald-600 text-white px-3 py-2 rounded hover:bg-emerald-700"
                >
                  Excel Ringkas (H/I/S/A)
                </button>
                <button
                  onClick={() => exportToGoogleSheets('absensi')}
                  className="text-xs bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700"
                >
                  Google Sheets
                </button>
                <button
                  onClick={handlePrint}
                  className="text-xs bg-gray-700 text-white px-3 py-2 rounded hover:bg-gray-800"
                >
                  Cetak
                </button>
              </div>
            </div>

            {/* Ringkasan Kelas Absensi */}
            {absensiSummary && (
              <div className="px-4 py-3 bg-white border-b border-gray-100 text-sm flex flex-wrap gap-4 items-center">
                <div>
                  <span className="font-semibold text-gray-700">
                    Total siswa:
                  </span>{' '}
                  {absensiSummary.totalSiswa}
                </div>
                <div>
                  <span className="font-semibold text-gray-700">
                    Total hari efektif:
                  </span>{' '}
                  {absensiSummary.totalHariKerja}
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-50 text-xs font-semibold text-green-700">
                    H {absensiSummary.totalHadir}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                    I {absensiSummary.totalIzin}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-xs font-semibold text-amber-700">
                    S {absensiSummary.totalSakit}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-50 text-xs font-semibold text-red-700">
                    A {absensiSummary.totalAlpha}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-gray-700">
                    Rata-rata hadir:
                  </span>{' '}
                  {absensiSummary.rataPersenHadir}%
                </div>
              </div>
            )}

            {/* Pencarian nama / NIS siswa */}
            <div className="px-4 pt-2 pb-3 bg-white border-b border-gray-100 flex flex-wrap gap-3 items-center print:hidden">
              <div className="text-sm text-gray-600">
                Cari siswa (nama / NIS):
              </div>
              <input
                type="text"
                value={searchNama}
                onChange={(e) => setSearchNama(e.target.value)}
                placeholder="Ketik nama atau NIS siswa..."
                className="border rounded-lg px-3 py-1.5 text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {searchNama && !filteredAbsensiSiswa.length && (
                <span className="text-xs text-red-500">
                  Tidak ada siswa yang cocok dengan "{searchNama}"
                </span>
              )}
            </div>

            {/* Ringkasan 1 siswa (jika hasil pencarian hanya 1) */}
            {singleStudentAbsensiSummary && (
              <div className="px-4 pb-3 bg-white border-b border-gray-100">
                <div className="inline-flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm">
                  <div>
                    <div className="font-semibold text-blue-800">
                      {singleStudentAbsensiSummary.nama}
                    </div>
                    <div className="text-xs text-blue-700">
                      NIS: {singleStudentAbsensiSummary.nis || '–'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 text-xs font-semibold text-green-700">
                      Hadir: {singleStudentAbsensiSummary.totalHadir}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                      Izin: {singleStudentAbsensiSummary.totalIzin}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 text-xs font-semibold text-amber-700">
                      Sakit: {singleStudentAbsensiSummary.totalSakit}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-xs font-semibold text-red-700">
                      Alpha: {singleStudentAbsensiSummary.totalAlpha}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-xs font-semibold text-gray-700">
                      Hari efektif: {singleStudentAbsensiSummary.totalHariKerja}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                      % Hadir: {singleStudentAbsensiSummary.persenHadir}%
                    </span>
                    {/* Tombol Export Laporan Orang Tua */}
                    <button
                      onClick={exportSingleStudentReport}
                      className="print:hidden text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-md hover:bg-emerald-700"
                    >
                      Export Laporan Siswa (Excel)
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-100 text-gray-700 uppercase font-bold text-xs">
                  <tr>
                    <th className="px-3 py-3 w-10">No</th>
                    <th className="px-3 py-3 min-w-[200px]">Nama</th>
                    {absensiData.dateStrings.map((ds) => {
                      const dateNum = parseInt(ds.split('-')[2])
                      const isSun = isSunday(ds)
                      return (
                        <th
                          key={ds}
                          className={`px-1 py-3 text-center w-8 border-l border-gray-200 ${
                            isSun ? 'bg-red-100 text-red-600' : ''
                          }`}
                        >
                          {dateNum}
                        </th>
                      )
                    })}
                    <th className="px-2 py-3 text-center border-l bg-blue-50">
                      I
                    </th>
                    <th className="px-2 py-3 text-center bg-amber-50">
                      S
                    </th>
                    <th className="px-2 py-3 text-center bg-red-50">
                      A
                    </th>
                    <th className="px-2 py-3 text-center bg-green-50 font-bold">
                      H
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredAbsensiSiswa.map((s, idx) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-center">{idx + 1}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {s.nama}
                      </td>
                      {absensiData.dateStrings.map((ds) => {
                        const st = s.absensiPerTanggal[ds]
                        const isSun = isSunday(ds)
                        return (
                          <td
                            key={ds}
                            className={`px-1 py-2 text-center border-l border-gray-100 ${
                              isSun ? 'bg-red-50' : ''
                            }`}
                          >
                            {st ? (
                              <span
                                className={`font-bold ${
                                  st === 'Hadir'
                                    ? 'text-green-600'
                                    : st === 'Izin'
                                    ? 'text-blue-600'
                                    : st === 'Sakit'
                                    ? 'text-amber-600'
                                    : 'text-red-600'
                                }`}
                              >
                                {st.charAt(0)}
                              </span>
                            ) : null}
                          </td>
                        )
                      })}
                      <td className="px-2 py-2 text-center bg-blue-50/50 font-bold">
                        {s.total.Izin}
                      </td>
                      <td className="px-2 py-2 text-center bg-amber-50/50 font-bold">
                        {s.total.Sakit}
                      </td>
                      <td className="px-2 py-2 text-center bg-red-50/50 font-bold">
                        {s.total.Alpha}
                      </td>
                      <td className="px-2 py-2 text-center bg-green-50/50 text-green-700 font-bold">
                        {s.total.Hadir}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* === TABLE TUGAS === */}
        {activeTab === 'tugas' && tugasData && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-wrap gap-3 justify-between items-center bg-slate-50 print:bg-white">
              <h3 className="font-bold text-gray-700">
                Tabel Nilai Tugas – {getNamaKelasFromList(selectedKelas, kelasList)} / {selectedMapel}{' '}
                <span className="text-sm font-normal text-gray-500">
                  ({tugasData.periode})
                </span>
              </h3>
              <div className="flex flex-wrap gap-2 print:hidden">
                <button
                  onClick={exportTugasToExcel}
                  className="text-xs bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700"
                >
                  Excel Detail
                </button>
                <button
                  onClick={exportTugasSummaryToExcel}
                  className="text-xs bg-emerald-600 text-white px-3 py-2 rounded hover:bg-emerald-700"
                >
                  Excel Ringkas (Rata²)
                </button>
                <button
                  onClick={exportCombinedSummaryToExcel}
                  className="text-xs bg-purple-600 text-white px-3 py-2 rounded hover:bg-purple-700"
                >
                  Excel Gabungan (Nilai + Absensi)
                </button>
                <button
                  onClick={() => exportToGoogleSheets('tugas')}
                  className="text-xs bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700"
                >
                  Google Sheets
                </button>
                <button
                  onClick={handlePrint}
                  className="text-xs bg-gray-700 text-white px-3 py-2 rounded hover:bg-gray-800"
                >
                  Cetak
                </button>
              </div>
            </div>

            {/* Legend Grade + Ringkasan Kelas Tugas */}
            <div className="px-4 pt-3 pb-2 bg-white border-b border-gray-100 text-xs text-gray-600 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-700 text-sm">
                  Legend:
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="text-base">🟢</span>
                  <span>A / ≥ 90</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <span className="text-base">⚪</span>
                  <span>B / 80–89</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="text-base">🟡</span>
                  <span>C / 70–79</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="text-base">🔴</span>
                  <span>D/E / &lt; 70</span>
                </span>
              </div>
            </div>

            {tugasSummary && (
              <div className="px-4 pb-3 bg-white border-b border-gray-100 text-sm flex flex-wrap gap-4">
                <div>
                  <span className="font-semibold text-gray-700">
                    Total siswa:
                  </span>{' '}
                  {tugasSummary.totalSiswa}
                </div>
                <div>
                  <span className="font-semibold text-gray-700">
                    Sudah dinilai:
                  </span>{' '}
                  {tugasSummary.countDinilai}
                </div>
                <div>
                  <span className="font-semibold text-gray-700">
                    Rata-rata kelas:
                  </span>{' '}
                  {tugasSummary.rataNilaiKelas}
                </div>
                <div>
                  <span className="font-semibold text-gray-700">
                    Di bawah KKM ({KKM_NILAI_TUGAS}):
                  </span>{' '}
                  {tugasSummary.siswaDiBawahKKM}
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-100 text-gray-700 uppercase font-bold text-xs">
                  <tr>
                    <th className="px-4 py-3 w-10">No</th>
                    <th className="px-4 py-3 min-w-[200px]">Nama</th>
                    {tugasData.tugas.map((t, i) => (
                      <th
                        key={t.id}
                        className="px-2 py-3 text-center min-w-[60px]"
                        title={t.judul}
                      >
                        T{i + 1}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center bg-blue-50">Rata</th>
                    <th className="px-4 py-3 text-center bg-purple-50">
                      Grade
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tugasData.siswa.map((s, idx) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-center">{idx + 1}</td>
                      <td className="px-4 py-2 font-medium">{s.nama}</td>
                      {tugasData.tugas.map((t) => {
                        const nilaiSiswa = s.nilaiTugas[t.id]?.nilai
                        const isNilaiRendah =
                          nilaiSiswa !== null &&
                          nilaiSiswa !== undefined &&
                          nilaiSiswa !== '-' &&
                          !Number.isNaN(Number(nilaiSiswa)) &&
                          Number(nilaiSiswa) < 70
                        return (
                          <td key={t.id} className="px-1 py-1 text-center">
                            {editingNilai?.siswaId === s.id &&
                            editingNilai?.tugasId === t.id ? (
                              <input
                                autoFocus
                                className={`w-12 text-center border-2 rounded px-1 outline-none ${
                                  isNilaiRendah
                                    ? 'border-red-500 text-red-700'
                                    : 'border-blue-500'
                                }`}
                                defaultValue={nilaiSiswa ?? ''}
                                onBlur={(e) =>
                                  updateNilaiTugas(
                                    s.id,
                                    t.id,
                                    e.target.value
                                  )
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') e.target.blur()
                                }}
                              />
                            ) : (
                              <div
                                className={`cursor-pointer rounded px-2 py-1 mx-auto w-fit transition ${getColorClass(
                                  nilaiSiswa
                                )} hover:brightness-95`}
                                onClick={() =>
                                  setEditingNilai({
                                    siswaId: s.id,
                                    tugasId: t.id
                                  })
                                }
                              >
                                {nilaiSiswa ?? '-'}
                              </div>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-4 py-2 text-center font-bold bg-blue-50/50">
                        {s.rataRata}
                      </td>

                      {/* Grade dengan Warna */}
                      <td className="p-2 text-center">
                        <span
                          className={`px-3 py-1 rounded-full text-xs shadow-sm border ${getColorClass(
                            s.grade
                          )}`}
                        >
                          {s.grade}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* === TABLE QUIZ === */}
        {activeTab === 'quiz' && quizData && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-wrap gap-3 justify-between items-center bg-slate-50 print:bg-white">
              <h3 className="font-bold text-gray-700">
                Tabel Nilai Quiz - {getNamaKelasFromList(selectedKelas, kelasList)} / {selectedMapel}{' '}
                <span className="text-sm font-normal text-gray-500">
                  ({quizData.periode})
                </span>
              </h3>
              <div className="flex flex-wrap gap-2 print:hidden">
                <button
                  onClick={handlePrint}
                  className="text-xs bg-gray-700 text-white px-3 py-2 rounded hover:bg-gray-800"
                >
                  Cetak
                </button>
              </div>
            </div>

            {quizSummary && (
              <div className="px-4 pb-3 pt-3 bg-white border-b border-gray-100 text-sm flex flex-wrap gap-4">
                <div>
                  <span className="font-semibold text-gray-700">
                    Total siswa:
                  </span>{' '}
                  {quizSummary.totalSiswa}
                </div>
                <div>
                  <span className="font-semibold text-gray-700">
                    Sudah dinilai:
                  </span>{' '}
                  {quizSummary.countDinilai}
                </div>
                <div>
                  <span className="font-semibold text-gray-700">
                    Rata-rata kelas:
                  </span>{' '}
                  {quizSummary.rataNilaiKelas}
                </div>
                <div>
                  <span className="font-semibold text-gray-700">
                    Di bawah KKM ({KKM_NILAI_TUGAS}):
                  </span>{' '}
                  {quizSummary.siswaDiBawahKKM}
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-100 text-gray-700 uppercase font-bold text-xs">
                  <tr>
                    <th className="px-4 py-3 w-10">No</th>
                    <th className="px-4 py-3 min-w-[200px]">Nama</th>
                    {quizData.quizzes.map((q, i) => (
                      <th
                        key={q.id}
                        className="px-2 py-3 text-center min-w-[60px]"
                        title={q.nama}
                      >
                        Q{i + 1}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center bg-blue-50">Rata</th>
                    <th className="px-4 py-3 text-center bg-purple-50">
                      Grade
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {quizData.siswa.map((s, idx) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-center">{idx + 1}</td>
                      <td className="px-4 py-2 font-medium">{s.nama}</td>
                      {quizData.quizzes.map((q) => {
                        const nilaiSiswa = s.nilaiQuiz[q.id]?.nilai
                        const isNilaiRendah =
                          nilaiSiswa !== null &&
                          nilaiSiswa !== undefined &&
                          nilaiSiswa !== '-' &&
                          !Number.isNaN(Number(nilaiSiswa)) &&
                          Number(nilaiSiswa) < 70
                        return (
                          <td key={q.id} className="px-1 py-1 text-center">
                            <div
                              className={`rounded px-2 py-1 mx-auto w-fit ${
                                isNilaiRendah
                                  ? 'bg-red-100 text-red-700 font-bold'
                                  : getColorClass(nilaiSiswa)
                              }`}
                            >
                              {nilaiSiswa ?? '-'}
                            </div>
                          </td>
                        )
                      })}
                      <td className="px-4 py-2 text-center font-bold bg-blue-50/50">
                        {s.rataRata}
                      </td>
                      <td className="p-2 text-center">
                        <span
                          className={`px-3 py-1 rounded-full text-xs shadow-sm border ${getColorClass(
                            s.grade
                          )}`}
                        >
                          {s.grade}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        )}

        {/* === TABLE REKAP WALI KELAS === */}
        {activeTab === 'rekap' && rekapWaliData && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-wrap gap-3 justify-between items-center bg-slate-50 print:bg-white">
              <div>
                <h3 className="font-bold text-gray-700">
                  Rekap Wali Kelas - {getNamaKelasFromList(selectedWaliKelas, waliKelasList)}
                </h3>
                <div className="text-xs text-gray-500">
                  Periode: {rekapWaliData.periode} • Total Tugas: {rekapWaliData.totalTugas} • Total Quiz: {rekapWaliData.totalQuiz} •
                  Total pertemuan absensi: {rekapWaliData.totalPertemuanKelas || 0}
                </div>
                <div className="text-[11px] text-gray-500">
                  Sesi tanpa catatan absensi siswa dihitung sebagai Alpha pada rekap.
                </div>
                <div className="text-[11px] text-gray-500">
                  Urutan rank: Rata akademik, skor absensi, Alpha paling sedikit, Hadir terbanyak, lalu nama.
                </div>
                {rekapWaliData.audit && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="px-2.5 py-1 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Siswa dinilai: {rekapWaliData.audit.siswaDenganNilaiAkademik}/{rekapWaliData.audit.totalSiswa}
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-[11px] bg-amber-50 text-amber-700 border border-amber-200">
                      Tanpa nilai akademik: {rekapWaliData.audit.siswaTanpaNilaiAkademik}
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-[11px] bg-sky-50 text-sky-700 border border-sky-200">
                      Sesi tercatat: {rekapWaliData.audit.totalSesiTercatatSiswa}/{rekapWaliData.audit.totalSesiTargetSiswa}
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-[11px] bg-red-50 text-red-700 border border-red-200">
                      Sesi tanpa catatan: {rekapWaliData.audit.totalSesiTanpaCatatan}
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-200">
                      Cakupan absensi: {rekapWaliData.audit.cakupanAbsensiPersen}%
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-[11px] bg-orange-50 text-orange-700 border border-orange-200">
                      Siswa tanpa catatan absensi: {rekapWaliData.audit.siswaTanpaCatatanAbsensi}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <button
                  onClick={exportRekapWaliToExcel}
                  className="text-xs bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700"
                >
                  Excel
                </button>
                <button
                  onClick={() => exportToGoogleSheets('rekap')}
                  className="text-xs bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700"
                >
                  Google Sheets
                </button>
                <button
                  onClick={handlePrint}
                  className="text-xs bg-gray-700 text-white px-3 py-2 rounded hover:bg-gray-800"
                >
                  Cetak
                </button>
              </div>
            </div>

            {waliKelasList.length > 1 && (
              <div className="px-4 py-3 border-b border-gray-100 bg-white">
                <label className="text-xs font-semibold text-gray-600 mr-2">Pilih Kelas Wali:</label>
                <select
                  value={selectedWaliKelas}
                  onChange={(e) => setSelectedWaliKelas(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {waliKelasList.map((k) => (
                    <option key={k.id} value={k.id}>
                      {getNamaKelasFromList(k.id, waliKelasList)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="px-4 py-3 border-b border-gray-100 bg-white flex flex-wrap items-center gap-3 print:hidden">
              <div className="text-sm text-gray-600">Cari siswa rekap wali (Nama / NIS):</div>
              <input
                type="text"
                value={searchRekapWali}
                onChange={(e) => setSearchRekapWali(e.target.value)}
                placeholder="Ketik nama atau NIS..."
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {searchRekapWali && !filteredRekapWaliSiswa.length && (
                <span className="text-xs text-red-500">
                  Tidak ada siswa yang cocok dengan "{searchRekapWali}"
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-100 text-gray-700 uppercase font-bold text-xs">
                  <tr>
                    <th className="px-4 py-3 w-10">Rank</th>
                    <th className="px-4 py-3 min-w-[200px]">Nama</th>
                    <th className="px-4 py-3">NIS</th>
                    <th className="px-3 py-3 text-center">Total Tugas</th>
                    <th className="px-3 py-3 text-center">Total Quiz</th>
                    <th className="px-3 py-3 text-center bg-blue-50">Total Nilai</th>
                    <th className="px-3 py-3 text-center bg-indigo-50">Rata Akademik</th>
                    <th className="px-3 py-3 text-center bg-cyan-50">Skor Absensi</th>
                    <th className="px-3 py-3 text-center bg-purple-50">Rata-rata Akhir</th>
                    <th className="px-3 py-3 text-center">H</th>
                    <th className="px-3 py-3 text-center">I</th>
                    <th className="px-3 py-3 text-center">S</th>
                    <th className="px-3 py-3 text-center">A</th>
                    <th className="px-3 py-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredRekapWaliSiswa.map((s, idx) => {
                    const bottomRank = rekapWaliData.siswa[rekapWaliData.siswa.length - 1]?.rank
                    const rata = s.rataRata === '-' ? null : Number(s.rataRata)
                    const isLow = (rata != null && rata < 70) || s.rank === bottomRank
                    return (
                      <tr
                        key={s.id}
                        className={`hover:bg-gray-50 ${isLow ? 'bg-red-50/60' : ''}`}
                      >
                        <td className={`px-4 py-2 text-center font-bold ${s.rank === 1 ? 'text-emerald-600' : ''}`}>
                          {s.rank}
                        </td>
                        <td className="px-4 py-2 font-medium">{s.nama}</td>
                        <td className="px-4 py-2">{s.nis}</td>
                        <td className="px-3 py-2 text-center">{s.totalTugas}</td>
                        <td className="px-3 py-2 text-center">{s.totalQuiz}</td>
                        <td className={`px-3 py-2 text-center font-bold ${isLow ? 'text-red-600' : ''}`}>
                          {s.totalNilai}
                        </td>
                        <td className="px-3 py-2 text-center">{s.rataAkademik}</td>
                        <td className="px-3 py-2 text-center">{s.skorAbsensi}</td>
                        <td className={`px-3 py-2 text-center font-semibold ${isLow ? 'text-red-600' : ''}`}>
                          {s.rataRata}
                        </td>
                        <td className="px-3 py-2 text-center">{s.absensi.Hadir}</td>
                        <td className="px-3 py-2 text-center">{s.absensi.Izin}</td>
                        <td className="px-3 py-2 text-center">{s.absensi.Sakit}</td>
                        <td className="px-3 py-2 text-center">{s.absensi.Alpha}</td>
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => openDetailSiswaNilaiMapel(s)}
                            className="px-2.5 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                          >
                            Detail
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {!filteredRekapWaliSiswa.length && (
                    <tr>
                      <td colSpan={14} className="px-4 py-6 text-center text-sm text-slate-500">
                        Tidak ada data siswa pada hasil pencarian.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-200 bg-slate-50/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-700">
                    Rekap Ekstrakurikuler Siswa
                  </h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Hanya menampilkan siswa kelas wali{' '}
                    {getNamaKelasFromList(selectedWaliKelas, waliKelasList)}.
                  </p>
                </div>
                <div className="text-[11px] text-slate-500">
                  Periode: {rekapWaliData.periode}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <span className="px-2.5 py-1 rounded-full text-[11px] bg-violet-50 text-violet-700 border border-violet-200">
                  Total Ekskul Aktif: {rekapWaliData.eskul?.summary?.totalEkskul || 0}
                </span>
                <span className="px-2.5 py-1 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Siswa ikut ekskul: {rekapWaliData.eskul?.summary?.siswaIkutEskul || 0}
                </span>
                <span className="px-2.5 py-1 rounded-full text-[11px] bg-amber-50 text-amber-700 border border-amber-200">
                  Siswa tanpa ekskul: {rekapWaliData.eskul?.summary?.siswaTanpaEskul || 0}
                </span>
                <span className="px-2.5 py-1 rounded-full text-[11px] bg-sky-50 text-sky-700 border border-sky-200">
                  Total keanggotaan: {rekapWaliData.eskul?.summary?.totalKeanggotaanEskul || 0}
                </span>
              </div>

              <div className="mt-3 bg-white rounded-xl border border-slate-200 px-3 py-2 flex flex-wrap items-center gap-3 print:hidden">
                <div className="text-sm text-gray-600">Cari rekap ekskul (Nama / NIS / Ekskul):</div>
                <input
                  type="text"
                  value={searchRekapEskul}
                  onChange={(e) => setSearchRekapEskul(e.target.value)}
                  placeholder="Ketik nama, NIS, atau nama ekskul..."
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-full sm:w-80 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {searchRekapEskul && !filteredRekapEskulSiswa.length && (
                  <span className="text-xs text-red-500">
                    Tidak ada data ekskul yang cocok dengan "{searchRekapEskul}"
                  </span>
                )}
              </div>

              <div className="overflow-x-auto mt-3 bg-white rounded-xl border border-slate-200">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-100 text-gray-700 uppercase font-bold text-xs">
                    <tr>
                      <th className="px-3 py-2 w-10">No</th>
                      <th className="px-3 py-2 min-w-[180px]">Nama</th>
                      <th className="px-3 py-2">NIS</th>
                      <th className="px-3 py-2 text-center">Jml Ekskul</th>
                      <th className="px-3 py-2 min-w-[240px]">Daftar Ekskul</th>
                      <th className="px-3 py-2 text-center">H</th>
                      <th className="px-3 py-2 text-center">I</th>
                      <th className="px-3 py-2 text-center">S</th>
                      <th className="px-3 py-2 text-center">A</th>
                      <th className="px-3 py-2 text-center">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredRekapEskulSiswa.map((s, idx) => {
                      const daftarEkskul = (s.eskul?.eskulList || []).join(', ') || '-'
                      return (
                        <tr key={`${s.id}-ekskul`} className="hover:bg-slate-50">
                          <td className="px-3 py-2 text-center">{idx + 1}</td>
                          <td className="px-3 py-2 font-medium">{s.nama}</td>
                          <td className="px-3 py-2">{s.nis}</td>
                          <td className="px-3 py-2 text-center">{s.eskul?.jumlahEkskul || 0}</td>
                          <td className="px-3 py-2">{daftarEkskul}</td>
                          <td className="px-3 py-2 text-center">{s.eskul?.totalAbsensi?.Hadir || 0}</td>
                          <td className="px-3 py-2 text-center">{s.eskul?.totalAbsensi?.Izin || 0}</td>
                          <td className="px-3 py-2 text-center">{s.eskul?.totalAbsensi?.Sakit || 0}</td>
                          <td className="px-3 py-2 text-center">{s.eskul?.totalAbsensi?.Alpha || 0}</td>
                          <td className="px-3 py-2 text-center font-semibold">{s.eskul?.totalAbsensi?.total || 0}</td>
                        </tr>
                      )
                    })}
                    {!filteredRekapEskulSiswa.length && (
                      <tr>
                        <td colSpan={10} className="px-3 py-6 text-center text-sm text-slate-500">
                          Tidak ada data ekstrakurikuler pada hasil pencarian.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {detailSiswaOpen && (
          <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm p-4 flex items-center justify-center">
            <div className="w-full max-w-6xl max-h-[92vh] bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-base font-bold text-slate-800">
                    Detail Nilai Mata Pelajaran
                  </h4>
                  <p className="text-xs text-slate-600 mt-1">
                    {detailSiswaData?.siswa?.nama || '-'} • NIS {detailSiswaData?.siswa?.nis || '-'}
                    {' • '}
                    Kelas {detailSiswaData?.summary?.kelas || '-'} • {detailSiswaData?.summary?.periode || '-'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={exportDetailSiswaMapelToExcel}
                    disabled={detailSiswaLoading}
                    className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Export Excel
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailSiswaOpen(false)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 text-white hover:bg-slate-800 transition-colors"
                  >
                    Tutup
                  </button>
                </div>
              </div>

              <div className="p-5 overflow-y-auto max-h-[calc(92vh-74px)]">
                {detailSiswaLoading ? (
                  <div className="py-10 text-center">
                    <div className="w-9 h-9 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-sm text-slate-500">Memuat detail nilai siswa...</p>
                  </div>
                ) : (
                  <>
                    {detailSiswaData?.summary && (
                      <div className="mb-4 flex flex-wrap gap-2">
                        <span className="px-2.5 py-1 rounded-full text-[11px] bg-blue-50 text-blue-700 border border-blue-200">
                          Total mapel: {detailSiswaData.summary.totalMapel}
                        </span>
                        <span className="px-2.5 py-1 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Mapel dinilai: {detailSiswaData.summary.mapelDenganNilai}
                        </span>
                        <span className="px-2.5 py-1 rounded-full text-[11px] bg-amber-50 text-amber-700 border border-amber-200">
                          Mapel tanpa nilai: {detailSiswaData.summary.mapelTanpaNilai}
                        </span>
                        <span className="px-2.5 py-1 rounded-full text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-200">
                          Total penilaian: {detailSiswaData.summary.totalPenilaian}
                        </span>
                        <span className="px-2.5 py-1 rounded-full text-[11px] bg-cyan-50 text-cyan-700 border border-cyan-200">
                          Rata akademik keseluruhan: {detailSiswaData.summary.rataKeseluruhan}
                        </span>
                        <span className="px-2.5 py-1 rounded-full text-[11px] bg-purple-50 text-purple-700 border border-purple-200">
                          Grade: {detailSiswaData.summary.gradeKeseluruhan}
                        </span>
                      </div>
                    )}

                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-100 text-slate-700 uppercase text-xs font-bold">
                          <tr>
                            <th className="px-3 py-2 w-10 text-center">No</th>
                            <th className="px-3 py-2 min-w-[180px]">Mata Pelajaran</th>
                            <th className="px-3 py-2 text-center">Total Tugas</th>
                            <th className="px-3 py-2 text-center">Total Quiz</th>
                            <th className="px-3 py-2 text-center">Total Nilai</th>
                            <th className="px-3 py-2 text-center">Jml Penilaian</th>
                            <th className="px-3 py-2 text-center">Rata Akademik</th>
                            <th className="px-3 py-2 text-center">Grade</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(detailSiswaData?.rows || []).length === 0 ? (
                            <tr>
                              <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                                Belum ada data nilai per mata pelajaran pada periode ini.
                              </td>
                            </tr>
                          ) : (
                            detailSiswaData.rows.map((row, idx) => (
                              <tr key={`${row.mapel}-${idx}`} className="hover:bg-slate-50/80">
                                <td className="px-3 py-2 text-center">{idx + 1}</td>
                                <td className="px-3 py-2 font-medium">{row.mapel}</td>
                                <td className="px-3 py-2 text-center">{row.nilaiTugas}</td>
                                <td className="px-3 py-2 text-center">{row.nilaiQuiz}</td>
                                <td className="px-3 py-2 text-center font-semibold">{row.totalNilai}</td>
                                <td className="px-3 py-2 text-center">{row.jumlahPenilaian}</td>
                                <td className="px-3 py-2 text-center">{row.rataAkademik}</td>
                                <td className="px-3 py-2 text-center">
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[11px] border ${getColorClass(
                                      row.grade
                                    )}`}
                                  >
                                    {row.grade}
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
