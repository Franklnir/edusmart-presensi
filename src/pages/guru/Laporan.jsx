// src/pages/guru/LaporanRekap.jsx
import React, { startTransition, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { queryClient, queryKeys } from '../../lib/queryClient'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { loadExcelJsBrowser } from '../../utils/excelBrowser'
import AcademicPeriodArchiveFilter from '../../components/AcademicPeriodArchiveFilter'
import useActiveAcademicPeriod from '../../hooks/useActiveAcademicPeriod'
import {
  getKelasDisplayName,
  getNamaKelasFromList,
  normalizeKelasKey,
  getDatesInPeriod,
  isSunday,
  getGrade,
  PREDIKAT_GRADE,
  getPredikatLabel,
  getKetuntasanStatus,
  getIntervensiStatus,
  buildCatatanWaliOtomatis,
  hitungStatistikNilai,
  getColorClass,
  bulanList,
  KKM_NILAI_TUGAS,
  REKAP_WALI_STATUS_BOBOT,
  RANKING_TIE_BREAK_KEYS,
  RANKING_TIE_BREAK_LABELS,
  DEFAULT_RANKING_POLICY,
  MAPEL_COMPONENT_WEIGHT_RULES,
  DEFAULT_MAPEL_COMPONENT_WEIGHTS,
  round2,
  getCellTextLength,
  autoFitWorksheetColumns,
  SELECTED_ROW_CLASS,
  buildSelectableRowClass,
  makeLocalId,
  normalizeQuizMode,
  normalizeMapelName,
  normalizeMapelKey,
  hitungSkorAbsensiWali,
  toNumberOrNull,
  parseArrayLikeValue,
  normalizeWeight,
  normalizeMapelComponentWeights,
  getMapelWeightValidation,
  normalizeTieBreakToken,
  normalizeTieBreakOrder,
  normalizeCoreMapelList,
  normalizeRankingPolicy,
  describeRankingPolicy,
  toDateOrNull,
  formatMiniDate,
  hitungRataSederhana,
  hitungRataBerbobot,
  hitungNilaiMapelBerbobot,
  hitungRataAkhirWali,
  compareNumberDescNullLast,
  getRankMetricValue,
  compareNamaAsc,
  compareRankWali,
  isSameRankGroup,
  rankSiswaWali,
  isSameRankOrder,
} from './laporan/laporanUtils'

// === Dynamic imports (Hanya ExcelJS) ===
let ExcelJS
const loadExcelLibrary = async () => {
  try {
    ExcelJS = await loadExcelJsBrowser()
    return true
  } catch (e) {
    console.error('Error loading ExcelJS:', e)
    return false
  }
}

const getCurrentMonthValue = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const getQuizSpecialLabel = (quiz) => {
  const mode = normalizeQuizMode(quiz)
  const name = String(quiz?.nama || quiz?.judul || quiz?.title || '').trim().toLowerCase()

  if (mode === 'uas' || /\b(uas|pas)\b|ujian akhir semester/.test(name)) return 'UAS'
  if (mode === 'uts' || /\b(uts|pts)\b|ujian tengah semester/.test(name)) return 'UTS'
  return ''
}

const getQuizColumnLabel = (quiz, index) => {
  const specialLabel = getQuizSpecialLabel(quiz)
  return specialLabel ? `Q${index + 1} ${specialLabel}` : `Q${index + 1}`
}

// ==============================
// ===== MAIN COMPONENT =========
// ==============================
export default function LaporanRekap() {
  const { user } = useAuthStore()
  const { pushToast, setLoading } = useUIStore()

  // -- UI State --
  const [activeTab, setActiveTab] = useState('absensi')
  const isRekapTab = activeTab === 'rekap' || activeTab === 'rekap_eskul'
  const [showBulanDropdown, setShowBulanDropdown] = useState(false)
  const dropdownRef = useRef(null)

  // -- Data Filter State --
  const [kelasList, setKelasList] = useState([])
  const [waliKelasList, setWaliKelasList] = useState([])
  const [selectedWaliKelas, setSelectedWaliKelas] = useState('')
  const [jadwalGuru, setJadwalGuru] = useState([])
  const [mapelList, setMapelList] = useState([])
  const [mapelComponentWeightRows, setMapelComponentWeightRows] = useState([])
  const [selectedWeightMapel, setSelectedWeightMapel] = useState('')
  const [mapelWeightForm, setMapelWeightForm] = useState({ ...DEFAULT_MAPEL_COMPONENT_WEIGHTS })
  const [savingMapelWeight, setSavingMapelWeight] = useState(false)

  // -- Selection State (Default Kosong) --
  const [selectedKelas, setSelectedKelas] = useState('')
  const [selectedMapel, setSelectedMapel] = useState('')
  const [selectedBulan, setSelectedBulan] = useState(() => [
    getCurrentMonthValue()
  ]) // Default: bulan berjalan
  const [tahun, setTahun] = useState(new Date().getFullYear())
  const {
    activeAcademicPeriod,
    academicYearOptions,
    isViewingArchivePeriod,
    period: reportPeriod,
    periodFilter,
    resetToActivePeriod,
    selectedAcademicPeriodPayload,
    semesterOptions,
    setAcademicYear,
    setSemester
  } = useActiveAcademicPeriod({
    storageKey: 'edusmart.guru.laporan.periodFilter'
  })

  // -- Data Result State --
  const [absensiData, setAbsensiData] = useState(null)
  const [tugasData, setTugasData] = useState(null)
  const [quizData, setQuizData] = useState(null)
  const [rekapWaliData, setRekapWaliData] = useState(null)
  const [rankingPolicy, setRankingPolicy] = useState(DEFAULT_RANKING_POLICY)
  const [editingNilai, setEditingNilai] = useState(null)
  const [editingQuizNilai, setEditingQuizNilai] = useState(null)
  const [excelReady, setExcelReady] = useState(false)
  const [detailSiswaOpen, setDetailSiswaOpen] = useState(false)
  const [detailSiswaLoading, setDetailSiswaLoading] = useState(false)
  const [detailSiswaData, setDetailSiswaData] = useState(null)
  const [selectedAbsensiRowId, setSelectedAbsensiRowId] = useState(null)
  const [selectedTugasRowId, setSelectedTugasRowId] = useState(null)
  const [selectedQuizRowId, setSelectedQuizRowId] = useState(null)
  const [selectedRekapRowId, setSelectedRekapRowId] = useState(null)
  const [selectedEskulRowId, setSelectedEskulRowId] = useState(null)
  const [selectedDetailNilaiRowKey, setSelectedDetailNilaiRowKey] = useState(null)

  // Pencarian siswa di tab Absensi
  const [searchNama, setSearchNama] = useState('')
  const [searchRekapWali, setSearchRekapWali] = useState('')
  const [rekapStatusFilter, setRekapStatusFilter] = useState('semua')
  const [searchRekapEskul, setSearchRekapEskul] = useState('')

  const selectedKelasMeta = useMemo(
    () => kelasList.find((kelas) => String(kelas.id) === String(selectedKelas)) || null,
    [kelasList, selectedKelas]
  )

  const selectedWaliKelasMeta = useMemo(
    () => waliKelasList.find((kelas) => String(kelas.id) === String(selectedWaliKelas)) || null,
    [selectedWaliKelas, waliKelasList]
  )

  const selectedFilterKelasMeta = isRekapTab ? selectedWaliKelasMeta : selectedKelasMeta

  const reportPeriodLabel = `${reportPeriod.tahunAjaran} - Tahun Ajaran`
  const isActiveReportPeriod = !isViewingArchivePeriod
  const selectedTahunAjaran = selectedAcademicPeriodPayload.tahun_ajaran
  const selectedSemester = selectedAcademicPeriodPayload.semester
  const reportMonthOptions = useMemo(
    () => ((reportPeriod.academicYearMonths?.length ? reportPeriod.academicYearMonths : reportPeriod.months) || []).map((month) => ({
      value: month.value,
      label: month.label,
      month: String(month.month).padStart(2, '0'),
      year: month.year
    })),
    [reportPeriod]
  )
  const reportMonthOptionValues = useMemo(
    () => reportMonthOptions.map((month) => month.value),
    [reportMonthOptions]
  )
  const monthLabelByValue = useCallback(
    (value) => {
      const normalized = String(value || '')
      return reportMonthOptions.find((month) => month.value === normalized)?.label
        || bulanList.find((month) => month.value === normalized || month.value === normalized.slice(-2))?.label
        || normalized
    },
    [reportMonthOptions]
  )

  useEffect(() => {
    if (!reportMonthOptionValues.length) return

    setSelectedBulan((prev) => {
      const kept = prev.filter((value) => reportMonthOptionValues.includes(value))
      if (kept.length) return kept

      const currentMonth = getCurrentMonthValue()
      if (reportMonthOptionValues.includes(currentMonth)) return [currentMonth]

      return [reportMonthOptionValues[0]]
    })
  }, [reportMonthOptionValues])

  const applyReportAcademicFilters = useCallback(
    (query) => {
      let next = query
      if (reportPeriod.tahunAjaran) next = next.eq('tahun_ajaran', reportPeriod.tahunAjaran)
      return next
    },
    [reportPeriod.tahunAjaran]
  )

  const loadSiswaForReport = useCallback(
    async (kelasId, recordUserIds = []) => {
      const ids = Array.from(new Set((recordUserIds || []).map((id) => String(id || '').trim()).filter(Boolean)))
      let query = supabase
        .from('profiles')
        .select('id, nama, nis, kelas, angkatan')
        .eq('role', 'siswa')
        .order('nama')

      if (!isActiveReportPeriod) {
        if (!ids.length) return []
        query = query.in('id', ids)
      } else {
        query = query.eq('kelas', kelasId)
      }

      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    [isActiveReportPeriod]
  )

  useEffect(() => {
    if (!rekapWaliData?.siswa?.length) return

    const activePolicy = rekapWaliData?.policy || rankingPolicy
    const normalizedRank = rankSiswaWali(rekapWaliData.siswa, activePolicy)
    if (isSameRankOrder(rekapWaliData.siswa, normalizedRank)) return

    setRekapWaliData((prev) => {
      if (!prev) return prev
      return { ...prev, siswa: normalizedRank }
    })
  }, [rekapWaliData?.siswa, rekapWaliData?.policy, rankingPolicy])

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
        let query = supabase.from('jadwal').select('*').eq('guru_id', user.id)
        query = applyReportAcademicFilters(query)
        const { data } = await query
        setJadwalGuru(data || [])
      } catch (e) {
        console.error(e)
      }
    }
    load()
  }, [applyReportAcademicFilters, user?.id])

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
  }, [user?.id])

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
        setSelectedKelas((prev) => {
          if (prev && sorted.some((k) => k.id === prev)) return prev
          return sorted.length ? sorted[0].id : ''
        })
      } catch (e) {
        console.error(e)
      }
    }
    load()
  }, [jadwalGuru])

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
    setSelectedMapel((prev) => {
      if (prev && mapels.includes(prev)) return prev
      return mapels.length ? mapels[0] : ''
    })
  }, [selectedKelas, jadwalGuru])

  useEffect(() => {
    const loadMapelComponentWeights = async () => {
      if (!user?.id) {
        setMapelComponentWeightRows([])
        return
      }
      try {
        const { data, error } = await supabase
          .from('guru_mapel_bobot')
          .select('*')
          .eq('guru_id', user.id)
          .order('mapel')

        if (error) throw error
        setMapelComponentWeightRows(data || [])
      } catch (error) {
        console.error('Gagal memuat bobot komponen mapel:', error)
        setMapelComponentWeightRows([])
      }
    }

    loadMapelComponentWeights()
  }, [user?.id])

  const mapelAmpuOptions = useMemo(() => {
    const dedup = new Map()
    ;(jadwalGuru || []).forEach((item) => {
      const mapel = normalizeMapelName(item?.mapel)
      const key = normalizeMapelKey(mapel)
      if (!key) return
      if (!dedup.has(key)) {
        dedup.set(key, mapel)
      }
    })
    return Array.from(dedup.values()).sort((a, b) => String(a || '').localeCompare(String(b || ''), 'id'))
  }, [jadwalGuru])

  const mapelWeightByMapelKey = useMemo(() => {
    const lookup = new Map()
    ;(mapelComponentWeightRows || []).forEach((row) => {
      const mapelKey = normalizeMapelKey(row?.mapel)
      if (!mapelKey) return
      lookup.set(mapelKey, normalizeMapelComponentWeights(row))
    })
    return lookup
  }, [mapelComponentWeightRows])
  const mapelWeightedKeySet = useMemo(
    () => new Set(Array.from(mapelWeightByMapelKey.keys())),
    [mapelWeightByMapelKey]
  )

  useEffect(() => {
    if (!mapelAmpuOptions.length) {
      setSelectedWeightMapel('')
      setMapelWeightForm({ ...DEFAULT_MAPEL_COMPONENT_WEIGHTS })
      return
    }

    if (!selectedWeightMapel || !mapelAmpuOptions.includes(selectedWeightMapel)) {
      setSelectedWeightMapel(mapelAmpuOptions[0])
      return
    }

    const saved = mapelWeightByMapelKey.get(normalizeMapelKey(selectedWeightMapel))
    setMapelWeightForm(saved ? { ...saved } : { ...DEFAULT_MAPEL_COMPONENT_WEIGHTS })
  }, [selectedWeightMapel, mapelAmpuOptions, mapelWeightByMapelKey])

  const mapelWeightValidation = useMemo(
    () => getMapelWeightValidation(mapelWeightForm),
    [mapelWeightForm]
  )
  const selectedMapelWeightRow = useMemo(() => {
    if (!selectedWeightMapel) return null
    const selectedMapelKey = normalizeMapelKey(selectedWeightMapel)
    return (mapelComponentWeightRows || []).find(
      (row) => normalizeMapelKey(row?.mapel) === selectedMapelKey
    ) || null
  }, [selectedWeightMapel, mapelComponentWeightRows])

  const handleSaveMapelWeight = useCallback(async () => {
    if (!user?.id) return
    if (!selectedWeightMapel) {
      pushToast('error', 'Pilih mapel terlebih dahulu.')
      return
    }

    if (!mapelWeightValidation.isValid) {
      pushToast('error', mapelWeightValidation.errors[0] || 'Bobot mapel belum valid.')
      return
    }

    const selectedMapelKey = normalizeMapelKey(selectedWeightMapel)
    const existing = (mapelComponentWeightRows || []).find(
      (row) => normalizeMapelKey(row?.mapel) === selectedMapelKey
    )
    const nowIso = new Date().toISOString()
    const payload = {
      id: existing?.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}`),
      guru_id: user.id,
      mapel: selectedWeightMapel,
      bobot_tugas_pr: mapelWeightValidation.normalized.bobot_tugas_pr,
      bobot_quiz_reguler: mapelWeightValidation.normalized.bobot_quiz_reguler,
      bobot_quiz_uts: mapelWeightValidation.normalized.bobot_quiz_uts,
      bobot_quiz_uas: mapelWeightValidation.normalized.bobot_quiz_uas,
      created_at: existing?.created_at || nowIso,
      updated_at: nowIso
    }

    try {
      setSavingMapelWeight(true)
      const { data, error } = await supabase
        .from('guru_mapel_bobot')
        .upsert(payload, { onConflict: 'tenant_id,guru_id,mapel' })
        .select('*')
        .single()
      if (error) throw error

      setMapelComponentWeightRows((prev) => {
        const next = [...(prev || [])]
        const idx = next.findIndex((row) => normalizeMapelKey(row?.mapel) === selectedMapelKey)
        if (idx >= 0) next[idx] = data
        else next.push(data)
        return next
      })

      pushToast('success', `Bobot mapel ${selectedWeightMapel} berhasil disimpan.`)
    } catch (error) {
      console.error('Gagal menyimpan bobot mapel:', error)
      pushToast('error', error?.message || 'Gagal menyimpan bobot mapel')
    } finally {
      setSavingMapelWeight(false)
    }
  }, [
    user?.id,
    selectedWeightMapel,
    mapelWeightValidation,
    mapelComponentWeightRows,
    pushToast
  ])

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
    const currentMonth = getCurrentMonthValue()
    setTahun(now.getFullYear())
    setSelectedBulan(reportMonthOptionValues.includes(currentMonth)
      ? [currentMonth]
      : reportMonthOptionValues.slice(0, 1))
  }

  // Shortcut: Semua bulan periode laporan
  const handleSelectAllMonths = () => {
    setSelectedBulan(reportMonthOptionValues)
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
  const buildTeacherSummaryParams = useCallback((type) => ({
    type,
    kelas: selectedKelas,
    mapel: selectedMapel,
    months: selectedBulan,
    tahun_ajaran: selectedTahunAjaran || reportPeriod.tahunAjaran,
    semester: selectedSemester || reportPeriod.semester
  }), [
    reportPeriod.semester,
    reportPeriod.tahunAjaran,
    selectedBulan,
    selectedKelas,
    selectedMapel,
    selectedSemester,
    selectedTahunAjaran
  ])

  const loadRekapAbsensi = useCallback(async () => {
    // Syarat: Kelas, Mapel, dan MINIMAL 1 Bulan dipilih
    if (!selectedKelas || !selectedMapel || selectedBulan.length === 0) {
      setAbsensiData(null)
      return
    }

    try {
      setLoading(true)
      const params = buildTeacherSummaryParams('absensi')
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.reports.teacherSummary(params),
        queryFn: async () => {
          const { data, error } = await supabase.reports.teacherSummary(params)
          if (error?.code === 'REQUEST_ABORTED') {
            const aborted = new Error('Request aborted')
            aborted.code = 'REQUEST_ABORTED'
            throw aborted
          }
          if (error) throw error
          return data
        },
        staleTime: 60 * 1000,
      })
      startTransition(() => setAbsensiData(data))
    } catch (e) {
      if (e?.code === 'REQUEST_ABORTED') return
      console.error(e)
      pushToast('error', 'Gagal memuat absensi')
    } finally {
      setLoading(false)
    }
  }, [
    buildTeacherSummaryParams,
    pushToast,
    selectedBulan,
    selectedKelas,
    selectedMapel,
    setLoading,
  ])

  const loadRekapTugas = useCallback(async () => {
    // Syarat: Kelas, Mapel, dan MINIMAL 1 Bulan dipilih
    if (!selectedKelas || !selectedMapel || selectedBulan.length === 0) {
      setTugasData(null)
      return
    }

    try {
      setLoading(true)
      const params = buildTeacherSummaryParams('tugas')
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.reports.teacherSummary(params),
        queryFn: async () => {
          const { data, error } = await supabase.reports.teacherSummary(params)
          if (error?.code === 'REQUEST_ABORTED') {
            const aborted = new Error('Request aborted')
            aborted.code = 'REQUEST_ABORTED'
            throw aborted
          }
          if (error) throw error
          return data
        },
        staleTime: 60 * 1000,
      })
      startTransition(() => setTugasData(data))
    } catch (e) {
      if (e?.code === 'REQUEST_ABORTED') return
      console.error(e)
      pushToast('error', 'Gagal memuat tugas')
    } finally {
      setLoading(false)
    }
  }, [
    buildTeacherSummaryParams,
    pushToast,
    selectedBulan,
    selectedKelas,
    selectedMapel,
    setLoading,
  ])

  const loadRekapQuiz = useCallback(async () => {
    if (!selectedKelas || !selectedMapel || selectedBulan.length === 0) {
      setQuizData(null)
      return
    }

    try {
      setLoading(true)
      const params = buildTeacherSummaryParams('quiz')
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.reports.teacherSummary(params),
        queryFn: async () => {
          const { data, error } = await supabase.reports.teacherSummary(params)
          if (error?.code === 'REQUEST_ABORTED') {
            const aborted = new Error('Request aborted')
            aborted.code = 'REQUEST_ABORTED'
            throw aborted
          }
          if (error) throw error
          return data
        },
        staleTime: 60 * 1000,
      })
      startTransition(() => setQuizData(data))
    } catch (e) {
      if (e?.code === 'REQUEST_ABORTED') return
      console.error(e)
      pushToast('error', 'Gagal memuat nilai quiz')
    } finally {
      setLoading(false)
    }
  }, [
    buildTeacherSummaryParams,
    pushToast,
    selectedBulan,
    selectedKelas,
    selectedMapel,
    setLoading,
  ])

  const loadRekapWali = useCallback(async () => {
    if (!selectedWaliKelas || selectedBulan.length === 0) {
      setRekapWaliData(null)
      return
    }

    try {
      setLoading(true)

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

      const activePolicy = DEFAULT_RANKING_POLICY
      const policySummary = describeRankingPolicy(activePolicy)
      setRankingPolicy(activePolicy)

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
        .select('id, nama, nis, kelas, angkatan')
        .eq('role', 'siswa')
        .order('nama')
      if (kelasAliasesRaw.length === 1) {
        siswaQuery = siswaQuery.eq('kelas', kelasAliasesRaw[0])
      } else {
        siswaQuery = siswaQuery.in('kelas', kelasAliasesRaw)
      }
      const { data: siswaRaw, error: siswaErr } = await siswaQuery
      if (siswaErr) throw siswaErr
      let siswaData = (siswaRaw || []).filter((s) =>
        kelasAliasNormSet.has(normalizeKelasKey(s.kelas))
      )

      const startDate = `${dateStrings[0]}T00:00:00`
      const endDate = `${dateStrings[dateStrings.length - 1]}T23:59:59`

      let jadwalKelasQuery = supabase
        .from('jadwal')
        .select('mapel, guru_id')
        .eq('kelas_id', selectedWaliKelas)
      jadwalKelasQuery = applyReportAcademicFilters(jadwalKelasQuery)
      const { data: jadwalKelasList } = await jadwalKelasQuery

      let tugasQuery = supabase
        .from('tugas')
        .select('*')
        .eq('kelas', selectedWaliKelas)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
      tugasQuery = applyReportAcademicFilters(tugasQuery)
      const { data: tugasList } = await tugasQuery

      const tugasIds = (tugasList || []).map((t) => t.id)
      let jawabanQuery = supabase
        .from('tugas_jawaban')
        .select('*')
        .in('tugas_id', tugasIds.length ? tugasIds : [-1])
      jawabanQuery = applyReportAcademicFilters(jawabanQuery)
      const { data: jawabanList } = await jawabanQuery

      let quizQuery = supabase
        .from('quizzes')
        .select('*')
        .eq('kelas_id', selectedWaliKelas)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
      quizQuery = applyReportAcademicFilters(quizQuery)
      const { data: quizList } = await quizQuery

      const guruIdsPengampu = Array.from(
        new Set((jadwalKelasList || []).map((item) => String(item?.guru_id || '').trim()).filter(Boolean))
      )
      let guruMapelWeightRows = []
      if (guruIdsPengampu.length) {
        const { data, error } = await supabase
          .from('guru_mapel_bobot')
          .select('*')
          .in('guru_id', guruIdsPengampu)
        if (error) {
          console.warn('Bobot mapel belum tersedia, memakai default:', error)
          guruMapelWeightRows = []
        } else {
          guruMapelWeightRows = data || []
        }
      }

      const quizIds = (quizList || []).map((q) => q.id)
      let submissionQuery = supabase
        .from('quiz_submissions')
        .select('*')
        .in('quiz_id', quizIds.length ? quizIds : [-1])
      submissionQuery = applyReportAcademicFilters(submissionQuery)
      const { data: submissionList } = await submissionQuery

      let absensiQuery = supabase
        .from('absensi')
        .select('*')
        .eq('kelas', selectedWaliKelas)
        .gte('tanggal', dateStrings[0])
        .lte('tanggal', dateStrings[dateStrings.length - 1])
      absensiQuery = applyReportAcademicFilters(absensiQuery)
      const { data: absensiList } = await absensiQuery

      if (!isActiveReportPeriod) {
        const historicalStudentIds = Array.from(
          new Set(
            [
              ...(jawabanList || []).map((row) => row.user_id),
              ...(submissionList || []).map((row) => row.siswa_id),
              ...(absensiList || []).map((row) => row.uid)
            ]
              .map((id) => String(id || '').trim())
              .filter(Boolean)
          )
        )

        if (historicalStudentIds.length) {
          let historicalSiswaQuery = supabase
            .from('profiles')
            .select('id, nama, nis, kelas, angkatan')
            .eq('role', 'siswa')
            .in('id', historicalStudentIds)
            .order('nama')
          const { data: historicalSiswaRaw, error: historicalSiswaErr } = await historicalSiswaQuery
          if (historicalSiswaErr) throw historicalSiswaErr
          siswaData = historicalSiswaRaw || []
        } else {
          siswaData = []
        }
      }

      const siswaIds = (siswaData || []).map((s) => s.id).filter(Boolean)
      let ekskulAnggotaList = []
      if (siswaIds.length) {
        let ekskulAnggotaQuery = supabase
          .from('ekskul_anggota')
          .select('user_id, ekskul_id')
          .in('user_id', siswaIds)
        ekskulAnggotaQuery = applyReportAcademicFilters(ekskulAnggotaQuery)
        const { data, error } = await ekskulAnggotaQuery
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
        let absensiEskulQuery = supabase
          .from('absensi_eskul')
          .select('user_id, ekskul_id, status, tanggal')
          .in('user_id', siswaIds)
          .in('ekskul_id', ekskulIds)
          .gte('tanggal', dateStrings[0])
          .lte('tanggal', dateStrings[dateStrings.length - 1])
        absensiEskulQuery = applyReportAcademicFilters(absensiEskulQuery)
        const { data, error } = await absensiEskulQuery
        if (error) throw error
        absensiEskulList = data || []
      }

      const jawabByKey = new Map()
        ; (jawabanList || []).forEach((j) => {
          jawabByKey.set(`${j.user_id}|${j.tugas_id}`, j)
        })

      const subByKey = new Map()
        ; (submissionList || []).forEach((s) => {
          subByKey.set(`${s.siswa_id}|${s.quiz_id}`, s)
        })

      const mapelGuruIdsByKey = new Map()
      ;(jadwalKelasList || []).forEach((item) => {
        const mapelKey = normalizeMapelKey(item?.mapel)
        const guruId = String(item?.guru_id || '').trim()
        if (!mapelKey || !guruId) return
        if (!mapelGuruIdsByKey.has(mapelKey)) {
          mapelGuruIdsByKey.set(mapelKey, new Set())
        }
        mapelGuruIdsByKey.get(mapelKey).add(guruId)
      })

      const mapelWeightLookup = new Map()
      ;(guruMapelWeightRows || []).forEach((row) => {
        const mapelKey = normalizeMapelKey(row?.mapel)
        const guruId = String(row?.guru_id || '').trim()
        if (!mapelKey || !guruId) return
        mapelWeightLookup.set(
          `${guruId}|${mapelKey}`,
          normalizeMapelComponentWeights(row)
        )
      })

      const resolveMapelWeightsByKey = (mapelKey) => {
        const guruIds = Array.from(mapelGuruIdsByKey.get(mapelKey) || [])
        for (const guruId of guruIds) {
          const found = mapelWeightLookup.get(`${guruId}|${mapelKey}`)
          if (found) return found
        }
        return { ...DEFAULT_MAPEL_COMPONENT_WEIGHTS }
      }

      const mapelBuckets = new Map()
      const ensureMapelBucket = (rawMapel) => {
        const mapelLabel = normalizeMapelName(rawMapel)
        const mapelKey = normalizeMapelKey(mapelLabel)
        if (!mapelBuckets.has(mapelKey)) {
          mapelBuckets.set(mapelKey, {
            key: mapelKey,
            mapel: mapelLabel,
            tugas: [],
            quiz: [],
            bobotKomponen: resolveMapelWeightsByKey(mapelKey)
          })
        }
        const bucket = mapelBuckets.get(mapelKey)
        if (bucket.mapel === 'Tanpa Mapel' && mapelLabel !== 'Tanpa Mapel') {
          bucket.mapel = mapelLabel
        }
        bucket.bobotKomponen = resolveMapelWeightsByKey(mapelKey)
        return bucket
      }

        ; (tugasList || []).forEach((t) => {
          ensureMapelBucket(t?.mapel).tugas.push(t)
        })

        ; (quizList || []).forEach((q) => {
          ensureMapelBucket(q?.mapel).quiz.push(q)
        })

        ; (policySummary.coreMapel || []).forEach((mapel) => {
          ensureMapelBucket(mapel)
        })

      const mapelUrutan = Array.from(mapelBuckets.values()).sort((a, b) =>
        String(a?.mapel || '').localeCompare(String(b?.mapel || ''), 'id')
      )

      const coreMapelNormSet = new Set(
        policySummary.coreMapel.map((item) => normalizeMapelKey(item))
      )

      const absensiByUser = new Map()
        ; (absensiList || []).forEach((a) => {
          const key = a.uid
          if (!absensiByUser.has(key)) {
            absensiByUser.set(key, { Hadir: 0, Izin: 0, Sakit: 0, Alpha: 0 })
          }
          if (absensiByUser.get(key)[a.status] != null) {
            absensiByUser.get(key)[a.status] += 1
          }
        })

      const sesiKelasSet = new Set()
        ; (absensiList || []).forEach((a) => {
          if (!a?.tanggal) return
          sesiKelasSet.add(`${a.tanggal}|${a.mapel || '-'}`)
        })
      const totalPertemuanKelas = sesiKelasSet.size

      const makeEskulStat = () => ({ Hadir: 0, Izin: 0, Sakit: 0, Alpha: 0, total: 0 })
      const namaEskulById = new Map(
        (ekskulList || []).map((e) => [String(e.id), e.nama || String(e.id)])
      )
      const anggotaEskulByUser = new Map()
        ; (ekskulAnggotaList || []).forEach((row) => {
          const uid = String(row.user_id || '')
          const eksId = String(row.ekskul_id || '')
          if (!uid || !eksId) return
          if (!anggotaEskulByUser.has(uid)) anggotaEskulByUser.set(uid, new Set())
          anggotaEskulByUser.get(uid).add(eksId)
        })

      const absensiEskulByPair = new Map()
        ; (absensiEskulList || []).forEach((row) => {
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
        let jumlahNilaiTugas = 0
        let jumlahNilaiQuiz = 0
        let totalQuizReguler = 0
        let totalQuizUts = 0
        let totalQuizUas = 0
        let jumlahQuizReguler = 0
        let jumlahQuizUts = 0
        let jumlahQuizUas = 0

        const mapelScores = mapelUrutan.map((mapelInfo) => {
          const daftarTugas = mapelInfo?.tugas || []
          const daftarQuiz = mapelInfo?.quiz || []

          const nilaiTugasMapel = daftarTugas
            .map((t) => {
              const j = jawabByKey.get(`${s.id}|${t.id}`)
              return toNumberOrNull(j?.nilai)
            })
            .filter((nilai) => nilai != null)

          const nilaiQuizMapel = []
          const nilaiQuizRegulerMapel = []
          const nilaiQuizUtsMapel = []
          const nilaiQuizUasMapel = []

          daftarQuiz.forEach((q) => {
            const sub = subByKey.get(`${s.id}|${q.id}`)
            const nilai = toNumberOrNull(sub?.score)
            if (nilai == null) return

            nilaiQuizMapel.push(nilai)
            const modeQuiz = normalizeQuizMode(q)
            if (modeQuiz === 'regular') {
              nilaiQuizRegulerMapel.push(nilai)
            } else if (modeQuiz === 'uas') {
              nilaiQuizUasMapel.push(nilai)
            } else {
              nilaiQuizUtsMapel.push(nilai)
            }
          })

          nilaiTugasMapel.forEach((nilai) => {
            totalTugas += nilai
            jumlahNilaiTugas += 1
          })

          nilaiQuizMapel.forEach((nilai) => {
            totalQuiz += nilai
            jumlahNilaiQuiz += 1
          })
          nilaiQuizRegulerMapel.forEach((nilai) => {
            totalQuizReguler += nilai
            jumlahQuizReguler += 1
          })
          nilaiQuizUtsMapel.forEach((nilai) => {
            totalQuizUts += nilai
            jumlahQuizUts += 1
          })
          nilaiQuizUasMapel.forEach((nilai) => {
            totalQuizUas += nilai
            jumlahQuizUas += 1
          })

          const rataTugasMapel = hitungRataSederhana(nilaiTugasMapel)
          const rataQuizMapel = hitungRataSederhana(nilaiQuizMapel)
          const rataQuizRegulerMapel = hitungRataSederhana(nilaiQuizRegulerMapel)
          const rataQuizUtsMapel = hitungRataSederhana(nilaiQuizUtsMapel)
          const rataQuizUasMapel = hitungRataSederhana(nilaiQuizUasMapel)
          const bobotKomponenMapel = normalizeMapelComponentWeights(mapelInfo?.bobotKomponen)
          const nilaiAkhirMapel = hitungNilaiMapelBerbobot({
            rataTugasMapel,
            rataQuizRegulerMapel,
            rataQuizUtsMapel,
            rataQuizUasMapel,
            bobotMapel: bobotKomponenMapel
          })

          return {
            mapel: mapelInfo?.mapel || 'Tanpa Mapel',
            mapelKey: mapelInfo?.key || normalizeMapelKey(mapelInfo?.mapel || 'Tanpa Mapel'),
            bobotKomponen: bobotKomponenMapel,
            rataTugas: rataTugasMapel,
            rataQuiz: rataQuizMapel,
            rataQuizReguler: rataQuizRegulerMapel,
            rataQuizUts: rataQuizUtsMapel,
            rataQuizUas: rataQuizUasMapel,
            nilaiAkhir: nilaiAkhirMapel,
            jumlahTugasDinilai: nilaiTugasMapel.length,
            jumlahQuizDinilai: nilaiQuizMapel.length,
            jumlahQuizRegulerDinilai: nilaiQuizRegulerMapel.length,
            jumlahQuizUtsDinilai: nilaiQuizUtsMapel.length,
            jumlahQuizUasDinilai: nilaiQuizUasMapel.length
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
        const totalNilai = round2(totalTugas + totalQuiz)
        const jumlahPenilaian = jumlahNilaiTugas + jumlahNilaiQuiz
        const rataTugas = jumlahNilaiTugas ? round2(totalTugas / jumlahNilaiTugas) : null
        const rataQuiz = jumlahNilaiQuiz ? round2(totalQuiz / jumlahNilaiQuiz) : null
        const rataQuizReguler = jumlahQuizReguler ? round2(totalQuizReguler / jumlahQuizReguler) : null
        const rataQuizUts = jumlahQuizUts ? round2(totalQuizUts / jumlahQuizUts) : null
        const rataQuizUas = jumlahQuizUas ? round2(totalQuizUas / jumlahQuizUas) : null
        const mapelDinilaiRows = mapelScores.filter((item) => toNumberOrNull(item.nilaiAkhir) != null)
        const rataAkademik = hitungRataSederhana(mapelDinilaiRows.map((item) => item.nilaiAkhir))
        const mapelIntiDinilaiRows = mapelScores.filter(
          (item) =>
            coreMapelNormSet.has(item.mapelKey) &&
            toNumberOrNull(item.nilaiAkhir) != null
        )
        const nilaiMapelInti = hitungRataSederhana(
          mapelIntiDinilaiRows.map((item) => item.nilaiAkhir)
        )
        const nilaiAkhir = hitungRataAkhirWali(rataAkademik, skorAbsensi, activePolicy)
        const mapelTuntas = mapelDinilaiRows.filter(
          (item) => toNumberOrNull(item.nilaiAkhir) != null && Number(item.nilaiAkhir) >= KKM_NILAI_TUGAS
        ).length
        const persenKetuntasanMapel = mapelDinilaiRows.length
          ? round2((mapelTuntas / mapelDinilaiRows.length) * 100)
          : null
        const statusKetuntasan = getKetuntasanStatus(nilaiAkhir)
        const statusIntervensi = getIntervensiStatus({
          nilaiAkhir,
          skorAbsensi,
          persenKetuntasanMapel
        })
        const predikatAkhir = getPredikatLabel(nilaiAkhir)
        const catatanWali = buildCatatanWaliOtomatis({
          nama: s.nama,
          nilaiAkhir,
          skorAbsensi,
          persenKetuntasanMapel
        })

        return {
          id: s.id,
          nama: s.nama,
          nis: s.nis,
          kelas: s.kelas,
          totalTugas: round2(totalTugas),
          totalQuiz: round2(totalQuiz),
          totalNilai,
          jumlahPenilaian,
          rataTugas: rataTugas ?? '-',
          rataQuiz: rataQuiz ?? '-',
          rataQuizReguler: rataQuizReguler ?? '-',
          rataQuizUts: rataQuizUts ?? '-',
          rataQuizUas: rataQuizUas ?? '-',
          rataAkademik: rataAkademik ?? '-',
          nilaiMapelInti: nilaiMapelInti ?? '-',
          skorAbsensi: skorAbsensi ?? '-',
          nilaiAkhir: nilaiAkhir ?? '-',
          rataRata: nilaiAkhir ?? '-',
          statusKetuntasan,
          statusIntervensi,
          predikatAkhir,
          catatanWali,
          mapelTuntas,
          persenKetuntasanMapel: persenKetuntasanMapel ?? '-',
          mapelScores,
          absensi: abs,
          eskul: rekapEskulByUser.get(String(s.id)) || makeEmptyEskulRekap(),
          audit: {
            tanpaNilaiAkademik: rataAkademik == null,
            sesiTercatat: sesiTercatatRaw,
            sesiTanpaCatatan: Math.max(0, totalPertemuanKelas - sesiTercatatRaw),
            mapelDinilai: mapelDinilaiRows.length,
            mapelTanpaNilai: Math.max(0, mapelUrutan.length - mapelDinilaiRows.length)
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

      const ranked = rankSiswaWali(siswaRows, activePolicy)
      const statistikNilaiAkhir = hitungStatistikNilai(
        ranked.map((row) => row.nilaiAkhir ?? row.rataRata)
      )
      const jumlahTuntas = ranked.filter((row) => row.statusKetuntasan === 'Tuntas').length
      const jumlahRemedial = ranked.filter((row) => row.statusKetuntasan === 'Remedial').length
      const jumlahBelumData = ranked.filter((row) => row.statusKetuntasan === 'Belum ada data').length
      const jumlahPerluPendampingan = ranked.filter(
        (row) => row.statusIntervensi === 'Perlu Pendampingan'
      ).length
      const jumlahIntervensiIntensif = ranked.filter(
        (row) => row.statusIntervensi === 'Intervensi Intensif'
      ).length
      const persenKetuntasanKelas = totalSiswa ? round2((jumlahTuntas / totalSiswa) * 100) : 0

      const namaBulanTerpilih = selectedBulan
        .map((b) => monthLabelByValue(b))
        .join(', ')

      setRekapWaliData({
        siswa: ranked,
        periode: `${namaBulanTerpilih} - ${reportPeriodLabel}`,
        totalTugas: tugasList?.length || 0,
        totalQuiz: quizList?.length || 0,
        totalMapel: mapelUrutan.length,
        totalPertemuanKelas,
        policy: policySummary,
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
        ringkasanAkademik: {
          rataNilaiAkhir: statistikNilaiAkhir.mean ?? '-',
          medianNilaiAkhir: statistikNilaiAkhir.median ?? '-',
          nilaiTertinggi: statistikNilaiAkhir.max ?? '-',
          nilaiTerendah: statistikNilaiAkhir.min ?? '-',
          jumlahTuntas,
          jumlahRemedial,
          jumlahBelumData,
          persenKetuntasanKelas,
          jumlahPerluPendampingan,
          jumlahIntervensiIntensif
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
  }, [
    applyReportAcademicFilters,
    isActiveReportPeriod,
    pushToast,
    reportPeriodLabel,
    selectedBulan,
    selectedWaliKelas,
    setLoading,
    tahun,
    waliKelasList
  ])

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

        let jadwalDetailQuery = supabase.from('jadwal').select('mapel, guru_id').eq('kelas_id', selectedWaliKelas)
        jadwalDetailQuery = applyReportAcademicFilters(jadwalDetailQuery)
        let tugasDetailQuery = supabase
          .from('tugas')
          .select('id, mapel')
          .eq('kelas', selectedWaliKelas)
          .gte('created_at', startDate)
          .lte('created_at', endDate)
        tugasDetailQuery = applyReportAcademicFilters(tugasDetailQuery)
        let quizDetailQuery = supabase
          .from('quizzes')
          .select('id, mapel, mode, is_live')
          .eq('kelas_id', selectedWaliKelas)
          .gte('created_at', startDate)
          .lte('created_at', endDate)
        quizDetailQuery = applyReportAcademicFilters(quizDetailQuery)

        const [jadwalRes, tugasRes, quizRes] = await Promise.all([
          jadwalDetailQuery,
          tugasDetailQuery,
          quizDetailQuery
        ])

        if (jadwalRes.error) throw jadwalRes.error
        if (tugasRes.error) throw tugasRes.error
        if (quizRes.error) throw quizRes.error

        const jadwalList = jadwalRes.data || []
        const tugasList = tugasRes.data || []
        const quizList = quizRes.data || []

        const guruIdsPengampu = Array.from(
          new Set((jadwalList || []).map((item) => String(item?.guru_id || '').trim()).filter(Boolean))
        )
        let guruMapelWeightRows = []
        if (guruIdsPengampu.length) {
          const { data, error } = await supabase
            .from('guru_mapel_bobot')
            .select('*')
            .in('guru_id', guruIdsPengampu)
          if (error) {
            console.warn('Bobot mapel detail siswa belum tersedia, memakai default:', error)
            guruMapelWeightRows = []
          } else {
            guruMapelWeightRows = data || []
          }
        }

        const tugasIds = tugasList.map((t) => t.id).filter(Boolean)
        const quizIds = quizList.map((q) => q.id).filter(Boolean)

        let jawabanList = []
        if (tugasIds.length) {
          let jawabanDetailQuery = supabase
            .from('tugas_jawaban')
            .select('tugas_id, nilai')
            .eq('user_id', siswa.id)
            .in('tugas_id', tugasIds)
          jawabanDetailQuery = applyReportAcademicFilters(jawabanDetailQuery)
          const { data, error } = await jawabanDetailQuery
          if (error) throw error
          jawabanList = data || []
        }

        let submissionList = []
        if (quizIds.length) {
          let submissionDetailQuery = supabase
            .from('quiz_submissions')
            .select('quiz_id, score')
            .eq('siswa_id', siswa.id)
            .in('quiz_id', quizIds)
          submissionDetailQuery = applyReportAcademicFilters(submissionDetailQuery)
          const { data, error } = await submissionDetailQuery
          if (error) throw error
          submissionList = data || []
        }

        const mapelSet = new Set()
        jadwalList.forEach((j) => mapelSet.add(normalizeMapel(j?.mapel)))
        tugasList.forEach((t) => mapelSet.add(normalizeMapel(t?.mapel)))
        quizList.forEach((q) => mapelSet.add(normalizeMapel(q?.mapel)))

        const mapelGuruIdsByKey = new Map()
        ;(jadwalList || []).forEach((item) => {
          const mapelKey = normalizeMapelKey(item?.mapel)
          const guruId = String(item?.guru_id || '').trim()
          if (!mapelKey || !guruId) return
          if (!mapelGuruIdsByKey.has(mapelKey)) mapelGuruIdsByKey.set(mapelKey, new Set())
          mapelGuruIdsByKey.get(mapelKey).add(guruId)
        })

        const mapelWeightLookup = new Map()
        ;(guruMapelWeightRows || []).forEach((row) => {
          const mapelKey = normalizeMapelKey(row?.mapel)
          const guruId = String(row?.guru_id || '').trim()
          if (!mapelKey || !guruId) return
          mapelWeightLookup.set(
            `${guruId}|${mapelKey}`,
            normalizeMapelComponentWeights(row)
          )
        })

        const resolveMapelWeightsByKey = (mapelKey) => {
          const guruIds = Array.from(mapelGuruIdsByKey.get(mapelKey) || [])
          for (const guruId of guruIds) {
            const found = mapelWeightLookup.get(`${guruId}|${mapelKey}`)
            if (found) return found
          }
          return { ...DEFAULT_MAPEL_COMPONENT_WEIGHTS }
        }

        const bucketMap = new Map()
        const ensureBucket = (mapel) => {
          if (!bucketMap.has(mapel)) {
            const mapelKey = normalizeMapelKey(mapel)
            bucketMap.set(mapel, {
              mapel,
              mapelKey,
              bobotKomponen: resolveMapelWeightsByKey(mapelKey),
              nilaiTugasList: [],
              nilaiQuizRegulerList: [],
              nilaiQuizUtsList: [],
              nilaiQuizUasList: [],
              nilaiTugas: 0,
              nilaiQuiz: 0,
              totalNilai: 0,
              jumlahPenilaian: 0,
              jumlahTugasDinilai: 0,
              jumlahQuizDinilai: 0,
              jumlahQuizRegulerDinilai: 0,
              jumlahQuizUtsDinilai: 0,
              jumlahQuizUasDinilai: 0,
              rataAkademik: '-',
              grade: '-'
            })
          }
          const bucket = bucketMap.get(mapel)
          bucket.bobotKomponen = resolveMapelWeightsByKey(bucket.mapelKey)
          return bucket
        }

        Array.from(mapelSet).forEach((mapel) => ensureBucket(mapel))

        const tugasById = new Map(tugasList.map((t) => [t.id, t]))
          ; (jawabanList || []).forEach((jawaban) => {
            const tugas = tugasById.get(jawaban.tugas_id)
            if (!tugas) return
            const nilai = toNumberOrNull(jawaban.nilai)
            if (nilai == null) return

            const mapel = normalizeMapel(tugas.mapel)
            const bucket = ensureBucket(mapel)
            bucket.nilaiTugasList.push(nilai)
            bucket.nilaiTugas = round2(bucket.nilaiTugas + nilai)
            bucket.totalNilai = round2(bucket.totalNilai + nilai)
            bucket.jumlahPenilaian += 1
            bucket.jumlahTugasDinilai += 1
          })

        const quizById = new Map(quizList.map((q) => [q.id, q]))
          ; (submissionList || []).forEach((sub) => {
            const quiz = quizById.get(sub.quiz_id)
            if (!quiz) return
            const nilai = toNumberOrNull(sub.score)
            if (nilai == null) return

            const mapel = normalizeMapel(quiz.mapel)
            const bucket = ensureBucket(mapel)
            const modeQuiz = normalizeQuizMode(quiz)
            if (modeQuiz === 'regular') {
              bucket.nilaiQuizRegulerList.push(nilai)
              bucket.jumlahQuizRegulerDinilai += 1
            } else if (modeQuiz === 'uas') {
              bucket.nilaiQuizUasList.push(nilai)
              bucket.jumlahQuizUasDinilai += 1
            } else {
              bucket.nilaiQuizUtsList.push(nilai)
              bucket.jumlahQuizUtsDinilai += 1
            }
            bucket.nilaiQuiz = round2(bucket.nilaiQuiz + nilai)
            bucket.totalNilai = round2(bucket.totalNilai + nilai)
            bucket.jumlahPenilaian += 1
            bucket.jumlahQuizDinilai += 1
          })

        const rows = Array.from(bucketMap.values())
          .map((row) => {
            const rataTugasMapel = hitungRataSederhana(row.nilaiTugasList)
            const rataQuizRegulerMapel = hitungRataSederhana(row.nilaiQuizRegulerList)
            const rataQuizUtsMapel = hitungRataSederhana(row.nilaiQuizUtsList)
            const rataQuizUasMapel = hitungRataSederhana(row.nilaiQuizUasList)
            const rataAkademik = hitungNilaiMapelBerbobot({
              rataTugasMapel,
              rataQuizRegulerMapel,
              rataQuizUtsMapel,
              rataQuizUasMapel,
              bobotMapel: row.bobotKomponen
            })
            const totalKomponenQuiz = [
              ...row.nilaiQuizRegulerList,
              ...row.nilaiQuizUtsList,
              ...row.nilaiQuizUasList
            ]
            const statusKetuntasan = getKetuntasanStatus(rataAkademik)
            return {
              ...row,
              rataTugas: rataTugasMapel ?? '-',
              rataQuizReguler: rataQuizRegulerMapel ?? '-',
              rataQuizUts: rataQuizUtsMapel ?? '-',
              rataQuizUas: rataQuizUasMapel ?? '-',
              rataQuiz: hitungRataSederhana(totalKomponenQuiz) ?? '-',
              rataAkademik: rataAkademik ?? '-',
              grade: getGrade(rataAkademik),
              statusKetuntasan,
              tindakLanjutMapel: statusKetuntasan === 'Remedial' ? 'Remedial mapel ini' : 'Pertahankan'
            }
          })
          .sort((a, b) => {
            const aNilai = toNumberOrNull(a.rataAkademik)
            const bNilai = toNumberOrNull(b.rataAkademik)
            if (aNilai != null && bNilai != null && bNilai !== aNilai) return bNilai - aNilai
            if (aNilai == null && bNilai != null) return 1
            if (aNilai != null && bNilai == null) return -1
            return String(a.mapel).localeCompare(String(b.mapel), 'id')
          })

        const totalNilai = rows.reduce((sum, r) => sum + Number(r.totalNilai || 0), 0)
        const totalPenilaian = rows.reduce((sum, r) => sum + Number(r.jumlahPenilaian || 0), 0)
        const totalMapel = rows.length
        const mapelDenganNilai = rows.filter((r) => Number(r.jumlahPenilaian || 0) > 0).length
        const mapelTanpaNilai = Math.max(0, totalMapel - mapelDenganNilai)
        const mapelTuntas = rows.filter((r) => r.statusKetuntasan === 'Tuntas').length
        const mapelRemedial = rows.filter((r) => r.statusKetuntasan === 'Remedial').length
        const nilaiAkhirMapelRows = rows
          .map((row) => toNumberOrNull(row.rataAkademik))
          .filter((nilai) => nilai != null)
        const rataKeseluruhan = hitungRataSederhana(nilaiAkhirMapelRows) ?? '-'

        const namaBulanTerpilih = selectedBulan
          .map((b) => monthLabelByValue(b))
          .join(', ')

        setDetailSiswaData({
          siswa,
          rows,
          summary: {
            periode: `${namaBulanTerpilih} - ${reportPeriodLabel}`,
            kelas: getNamaKelasFromList(selectedWaliKelas, waliKelasList),
            totalMapel,
            mapelDenganNilai,
            mapelTanpaNilai,
            mapelTuntas,
            mapelRemedial,
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
    [
      applyReportAcademicFilters,
      pushToast,
      reportPeriodLabel,
      selectedBulan,
      selectedWaliKelas,
      tahun,
      waliKelasList
    ]
  )

  // REALTIME TRIGGER
  useEffect(() => {
    if (isRekapTab) {
      loadRekapWali()
      return
    }

    if (!selectedKelas || !selectedMapel) {
      if (activeTab === 'absensi') setAbsensiData(null)
      else if (activeTab === 'tugas') setTugasData(null)
      else if (activeTab === 'quiz') setQuizData(null)
      return
    }

    if (activeTab === 'absensi') loadRekapAbsensi()
    else if (activeTab === 'tugas') loadRekapTugas()
    else if (activeTab === 'quiz') loadRekapQuiz()
  }, [
    activeTab,
    isRekapTab,
    loadRekapAbsensi,
    loadRekapQuiz,
    loadRekapTugas,
    loadRekapWali,
    selectedKelas,
    selectedMapel
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

  const rankedRekapWaliSiswa = useMemo(
    () => rankSiswaWali(rekapWaliData?.siswa || [], rekapWaliData?.policy || rankingPolicy),
    [rekapWaliData?.siswa, rekapWaliData?.policy, rankingPolicy]
  )

  const filteredRekapWaliSiswa = useMemo(() => {
    if (!rankedRekapWaliSiswa.length) return []
    const q = searchRekapWali.trim().toLowerCase()
    return rankedRekapWaliSiswa.filter((s) => {
      const nama = String(s.nama || '').toLowerCase()
      const nis = String(s.nis || '').toLowerCase()
      const matchSearch = !q || nama.includes(q) || nis.includes(q)
      if (!matchSearch) return false

      if (rekapStatusFilter === 'semua') return true
      if (rekapStatusFilter === 'tuntas') return s.statusKetuntasan === 'Tuntas'
      if (rekapStatusFilter === 'remedial') return s.statusKetuntasan === 'Remedial'
      if (rekapStatusFilter === 'pendampingan') return s.statusIntervensi === 'Perlu Pendampingan'
      if (rekapStatusFilter === 'intensif') return s.statusIntervensi === 'Intervensi Intensif'
      if (rekapStatusFilter === 'belum_data') return s.statusKetuntasan === 'Belum ada data'
      return true
    })
  }, [rankedRekapWaliSiswa, searchRekapWali, rekapStatusFilter])

  const filteredRekapEskulSiswa = useMemo(() => {
    if (!rankedRekapWaliSiswa.length) return []
    const q = searchRekapEskul.trim().toLowerCase()
    if (!q) return rankedRekapWaliSiswa

    return rankedRekapWaliSiswa.filter((s) => {
      const nama = String(s.nama || '').toLowerCase()
      const nis = String(s.nis || '').toLowerCase()
      const daftarEskul = String((s.eskul?.eskulList || []).join(', ')).toLowerCase()
      return nama.includes(q) || nis.includes(q) || daftarEskul.includes(q)
    })
  }, [rankedRekapWaliSiswa, searchRekapEskul])

  const ensureNilaiMutationAllowed = useCallback(async () => {
    return true
  }, [])

  // ==============================
  // ===== CRUD & ACTIONS =========
  // ==============================

  const updateNilaiTugas = async (siswaId, tugasId, nilaiBaru) => {
    if (!tugasData) return
    try {
      const isAllowed = await ensureNilaiMutationAllowed()
      if (!isAllowed) return

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

      let existingJawabanQuery = supabase
        .from('tugas_jawaban')
        .select('id')
        .eq('user_id', siswaId)
        .eq('tugas_id', tugasId)
      existingJawabanQuery = applyReportAcademicFilters(existingJawabanQuery)
      const { data: existing, error: fetchErr } = await existingJawabanQuery.maybeSingle()
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
      pushToast('error', `Gagal menyimpan: ${e?.message || 'Terjadi kesalahan'}`)
    } finally {
      setLoading(false)
    }
  }

  const updateNilaiQuiz = async (siswaId, quizId, nilaiBaru) => {
    if (!quizData) return
    try {
      const isAllowed = await ensureNilaiMutationAllowed()
      if (!isAllowed) return

      setLoading(true)
      let scoreFinal = null
      if (nilaiBaru !== '' && nilaiBaru !== null) {
        const n = Number(nilaiBaru)
        if (Number.isNaN(n) || n < 0 || n > 100) {
          pushToast('error', 'Nilai harus 0–100')
          setLoading(false)
          return
        }
        scoreFinal = Math.round(n)
      }

      let existingSubmissionQuery = supabase
        .from('quiz_submissions')
        .select('id, status, created_at')
        .eq('siswa_id', siswaId)
        .eq('quiz_id', quizId)
      existingSubmissionQuery = applyReportAcademicFilters(existingSubmissionQuery)
      const { data: existing, error: fetchErr } = await existingSubmissionQuery.maybeSingle()
      if (fetchErr) throw fetchErr

      const nowIso = new Date().toISOString()
      if (existing) {
        const payload = {
          score: scoreFinal,
          updated_at: nowIso
        }
        if (scoreFinal !== null) {
          payload.status = 'finished'
          payload.finished_at = nowIso
        }

        const { error } = await supabase
          .from('quiz_submissions')
          .update(payload)
          .eq('id', existing.id)
        if (error) throw error
      } else if (scoreFinal !== null) {
        const { error } = await supabase
          .from('quiz_submissions')
          .insert({
            id: makeLocalId(),
            quiz_id: quizId,
            siswa_id: siswaId,
            status: 'finished',
            score: scoreFinal,
            started_at: nowIso,
            finished_at: nowIso,
            created_at: nowIso,
            updated_at: nowIso
          })
        if (error) throw error
      }

      setQuizData((prev) => {
        if (!prev) return prev
        const siswaBaru = prev.siswa.map((s) => {
          if (s.id !== siswaId) return s
          const nilaiQuiz = {
            ...s.nilaiQuiz,
            [quizId]: { ...s.nilaiQuiz[quizId], nilai: scoreFinal }
          }
          const { rataRata, grade } = hitungRataRataDanGrade(nilaiQuiz)
          return { ...s, nilaiQuiz, rataRata, grade }
        })
        return { ...prev, siswa: siswaBaru }
      })
      pushToast('success', 'Nilai quiz tersimpan')
      setEditingQuizNilai(null)
    } catch (e) {
      console.error('Error:', e)
      pushToast('error', `Gagal menyimpan nilai quiz: ${e?.message || 'Terjadi kesalahan'}`)
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
    ws.mergeCells(1, 1, 1, 10)
    title.alignment = { horizontal: 'center' }

    ws.addRow([`NIS: ${siswa.nis || '-'}`])
    ws.mergeCells(2, 1, 2, 10)
    ws.addRow([`Kelas: ${summary.kelas || '-'}`])
    ws.mergeCells(3, 1, 3, 10)
    ws.addRow([`Periode: ${summary.periode || '-'}`])
    ws.mergeCells(4, 1, 4, 10)
    ws.addRow([])

    const header = ws.addRow([
      'No',
      'Mata Pelajaran',
      'Total Nilai Tugas',
      'Total Nilai Quiz',
      'Total Nilai',
      'Jumlah Penilaian',
      'Rata Akademik',
      'Grade',
      'Ketuntasan',
      'Tindak Lanjut'
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
        row.grade,
        row.statusKetuntasan || '-',
        row.tindakLanjutMapel || '-'
      ])
      excelRow.eachCell((cell, col) => {
        cell.border = borderAll
        if (col === 2 || col === 10) cell.alignment = { horizontal: 'left' }
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
      summary.gradeKeseluruhan || '-',
      '',
      `Tuntas ${summary.mapelTuntas ?? 0} | Remedial ${summary.mapelRemedial ?? 0}`
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
    ws.getColumn(9).width = 14
    ws.getColumn(10).width = 30

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
      csv += `Rank${sep}Nama${sep}NIS${sep}Total Tugas${sep}Total Quiz${sep}Rata Tugas${sep}Rata Quiz${sep}Rata Akademik (Mapel)${sep}Nilai Mapel Inti${sep}Skor Absensi${sep}Nilai Akhir Berbobot${sep}Predikat${sep}Ketuntasan${sep}Tindak Lanjut${sep}Catatan Wali${sep}Hadir${sep}Izin${sep}Sakit${sep}Alpha\n`
      const rankedRows = rankSiswaWali(
        rekapWaliData.siswa || [],
        rekapWaliData.policy || rankingPolicy
      )
      rankedRows.forEach((s) => {
        const safeCatatan = String(s.catatanWali || '-').replace(/"/g, '""')
        csv += `${s.rank}${sep}"${s.nama}"${sep}'${s.nis}'${sep}${s.totalTugas}${sep}${s.totalQuiz}${sep}${s.rataTugas}${sep}${s.rataQuiz}${sep}${s.rataAkademik}${sep}${s.nilaiMapelInti}${sep}${s.skorAbsensi}${sep}${s.nilaiAkhir ?? s.rataRata}${sep}"${s.predikatAkhir || getPredikatLabel(s.nilaiAkhir ?? s.rataRata)}"${sep}"${s.statusKetuntasan || getKetuntasanStatus(s.nilaiAkhir ?? s.rataRata)}"${sep}"${s.statusIntervensi || '-'}"${sep}"${safeCatatan}"${sep}${s.absensi.Hadir}${sep}${s.absensi.Izin}${sep}${s.absensi.Sakit}${sep}${s.absensi.Alpha}\n`
      })
    } else if (type === 'rekap_eskul' && rekapWaliData) {
      csv += `No${sep}Nama${sep}NIS${sep}Jml Eskul${sep}Daftar Eskul${sep}Eskul H${sep}Eskul I${sep}Eskul S${sep}Eskul A${sep}Total Presensi Eskul\n`
      const rankedRows = rankSiswaWali(
        rekapWaliData.siswa || [],
        rekapWaliData.policy || rankingPolicy
      )
      rankedRows.forEach((s, i) => {
        const daftarEskul = (s.eskul?.eskulList || []).join(', ')
        const safeDaftarEskul = String(daftarEskul || '-').replace(/"/g, '""')
        csv += `${i + 1}${sep}"${s.nama}"${sep}'${s.nis}'${sep}${s.eskul?.jumlahEkskul || 0}${sep}"${safeDaftarEskul}"${sep}${s.eskul?.totalAbsensi?.Hadir || 0}${sep}${s.eskul?.totalAbsensi?.Izin || 0}${sep}${s.eskul?.totalAbsensi?.Sakit || 0}${sep}${s.eskul?.totalAbsensi?.Alpha || 0}${sep}${s.eskul?.totalAbsensi?.total || 0}\n`
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
      'Rata Tugas',
      'Rata Quiz',
      'Rata Akademik (Mapel)',
      'Nilai Mapel Inti',
      'Skor Absensi',
      'Nilai Akhir Berbobot',
      'Predikat',
      'Ketuntasan',
      'Tindak Lanjut',
      'Catatan Wali',
      'Hadir',
      'Izin',
      'Sakit',
      'Alpha'
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

    const rankedRows = rankSiswaWali(
      rekapWaliData.siswa || [],
      rekapWaliData.policy || rankingPolicy
    )
    rankedRows.forEach((s) => {
      const row = ws.addRow([
        s.rank,
        s.nama,
        s.nis,
        s.totalTugas,
        s.totalQuiz,
        s.rataTugas,
        s.rataQuiz,
        s.rataAkademik,
        s.nilaiMapelInti,
        s.skorAbsensi,
        s.nilaiAkhir ?? s.rataRata,
        s.predikatAkhir || getPredikatLabel(s.nilaiAkhir ?? s.rataRata),
        s.statusKetuntasan || getKetuntasanStatus(s.nilaiAkhir ?? s.rataRata),
        s.statusIntervensi || '-',
        s.catatanWali || '-',
        s.absensi.Hadir,
        s.absensi.Izin,
        s.absensi.Sakit,
        s.absensi.Alpha
      ])
      row.getCell(2).alignment = { horizontal: 'left' }
      row.getCell(15).alignment = { horizontal: 'left', wrapText: true, vertical: 'top' }
    })

    ws.columns = [
      { width: 8 },  // Rank
      { width: 28 }, // Nama
      { width: 18 }, // NIS
      { width: 16 }, // Total Tugas
      { width: 16 }, // Total Quiz
      { width: 14 }, // Rata Tugas
      { width: 14 }, // Rata Quiz
      { width: 20 }, // Rata Akademik
      { width: 18 }, // Nilai Mapel Inti
      { width: 16 }, // Skor Absensi
      { width: 20 }, // Nilai Akhir
      { width: 22 }, // Predikat
      { width: 14 }, // Ketuntasan
      { width: 24 }, // Tindak lanjut
      { width: 52 }, // Catatan wali
      { width: 10 }, // H
      { width: 10 }, // I
      { width: 10 }, // S
      { width: 10 }  // A
    ]

    autoFitWorksheetColumns(ws, {
      min: 10,
      max: 60,
      hardMin: {
        1: 8,
        2: 24,
        3: 16,
        15: 40
      },
      hardMax: {
        15: 80
      }
    })

    ws.eachRow((excelRow, rowNumber) => {
      excelRow.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        }
        if (rowNumber === 1) {
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
        } else if (colNumber === 2 || colNumber === 15) {
          cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: colNumber === 15 }
        } else {
          cell.alignment = { horizontal: 'center', vertical: 'middle' }
        }
      })
    })

    const buf = await wb.xlsx.writeBuffer()
    saveBlob(buf, 'Rekap_Wali_Kelas_Akademik.xlsx')
  }

  const exportRekapEskulToExcel = async () => {
    if (!rekapWaliData) return
    if (!excelReady) {
      pushToast('error', 'Library Excel belum siap, coba beberapa detik lagi')
      return
    }

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Rekap Ekskul')
    const headers = ['No', 'Nama', 'NIS', 'Jml Eskul', 'Daftar Eskul', 'Eskul H', 'Eskul I', 'Eskul S', 'Eskul A', 'Total Presensi Eskul']

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
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    })

    const rankedRows = rankSiswaWali(
      rekapWaliData.siswa || [],
      rekapWaliData.policy || rankingPolicy
    )
    rankedRows.forEach((s, i) => {
      const row = ws.addRow([
        i + 1,
        s.nama,
        s.nis,
        s.eskul?.jumlahEkskul || 0,
        (s.eskul?.eskulList || []).join(', ') || '-',
        s.eskul?.totalAbsensi?.Hadir || 0,
        s.eskul?.totalAbsensi?.Izin || 0,
        s.eskul?.totalAbsensi?.Sakit || 0,
        s.eskul?.totalAbsensi?.Alpha || 0,
        s.eskul?.totalAbsensi?.total || 0
      ])

      row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' }
      row.getCell(5).alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
    })

    ws.columns = [
      { width: 8 },
      { width: 30 },
      { width: 18 },
      { width: 14 },
      { width: 44 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 20 }
    ]

    autoFitWorksheetColumns(ws, {
      min: 10,
      max: 55,
      hardMin: {
        1: 8,
        2: 24,
        3: 16,
        5: 36
      },
      hardMax: {
        5: 70
      }
    })

    ws.eachRow((excelRow, rowNumber) => {
      if (rowNumber === 1) return
      excelRow.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        }
        if (colNumber !== 2 && colNumber !== 5) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' }
        }
      })
    })

    const buf = await wb.xlsx.writeBuffer()
    saveBlob(buf, 'Rekap_Wali_Kelas_Ekskul.xlsx')
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
        <div className="page-title-card print:hidden">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                <span className="text-2xl text-white">📊</span>
              </div>
              <div>
                <h1 className="page-title-heading">Laporan Guru</h1>
                <p className="page-title-description">Rekap absensi, tugas, quiz, dan laporan wali kelas dalam satu panel.</p>
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
          className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/60 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-4 print:hidden"
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
          {!isRekapTab && (
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

          <AcademicPeriodArchiveFilter
            activeAcademicPeriod={activeAcademicPeriod}
            periodFilter={periodFilter}
            academicYearOptions={academicYearOptions}
            semesterOptions={semesterOptions}
            setAcademicYear={setAcademicYear}
            setSemester={setSemester}
            resetToActivePeriod={resetToActivePeriod}
            title="Periode Laporan"
            compact
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Angkatan
            </label>
            <div className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm bg-slate-50 font-semibold text-slate-900">
              {selectedFilterKelasMeta?.angkatan || '-'}
            </div>
            <div className="mt-1 text-[11px] text-slate-500 truncate">
              Mengikuti kelas yang dipilih.
            </div>
          </div>

          {/* Multi-Select Bulan */}
          <div className="relative" ref={dropdownRef}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bulan & Tahun
            </label>
            <div>
              <button
                type="button"
                className="w-full border border-slate-300 rounded-xl px-4 py-3 text-left bg-white flex justify-between items-center text-sm min-w-0"
                onClick={() => setShowBulanDropdown(!showBulanDropdown)}
              >
                <span
                  className={`block truncate ${selectedBulan.length === 0
                    ? 'text-gray-400'
                    : 'text-gray-900'
                    }`}
                >
                  {selectedBulan.length === 0
                    ? 'Pilih Bulan...'
                    : `${selectedBulan.length} Bulan`}
                </span>
                <svg
                  className="w-4 h-4 text-gray-500 shrink-0"
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
            </div>
            <div className="mt-1 text-[11px] text-slate-500 truncate">
              {reportPeriod.rangeLabel || 'Mengikuti periode akademik'}
            </div>

            {showBulanDropdown && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                <div className="p-2 space-y-1">
                  {reportMonthOptions.map((b) => (
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
                else if (isRekapTab) loadRekapWali()
              }}
            >
              <span>🔄</span> Muat Ulang
            </button>
          </div>
        </div>

        {!isRekapTab && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/60 print:hidden">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-800">Bobot Penilaian Per Mapel (Guru Pengampu)</h3>
              <p className="text-sm text-slate-600 mt-1">
                Atur bobot nilai untuk mapel yang Anda ampu. Setiap mapel harus total tepat 100%.
              </p>
            </div>
            <div className="text-xs text-slate-500 max-w-2xl leading-relaxed">
              Rumus mapel: Nilai Akhir Mapel = (RTugasxBTugas + RRegulerxBReguler + RUTSxBUTS + RUASxBUAS) /
              total bobot komponen yang memiliki nilai.
            </div>
          </div>

          {!mapelAmpuOptions.length ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 px-4 py-3 text-sm">
              Belum ada mapel yang terdeteksi di jadwal Anda.
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="lg:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Mapel Pengampu (Checklist Bobot)</label>
                  <div className="w-full border border-slate-300 rounded-xl bg-white max-h-44 overflow-y-auto divide-y divide-slate-100">
                    {mapelAmpuOptions.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setSelectedWeightMapel(item)}
                        className={`w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 ${
                          selectedWeightMapel === item
                            ? 'bg-indigo-50'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={mapelWeightedKeySet.has(normalizeMapelKey(item))}
                            readOnly
                            className="rounded text-emerald-600 focus:ring-emerald-500 pointer-events-none"
                          />
                          <span
                            className={`text-sm ${
                              selectedWeightMapel === item
                                ? 'font-semibold text-indigo-700'
                                : 'text-slate-700'
                            }`}
                          >
                            {item}
                          </span>
                        </div>
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full border ${
                            mapelWeightedKeySet.has(normalizeMapelKey(item))
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}
                        >
                          {mapelWeightedKeySet.has(normalizeMapelKey(item)) ? 'Dibobot' : 'Default'}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Centang berarti mapel sudah punya bobot khusus. Klik baris mapel untuk mengedit bobotnya.
                  </p>
                </div>

                {MAPEL_COMPONENT_WEIGHT_RULES.map((rule) => (
                  <div key={rule.key}>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      {rule.label} ({rule.min}-{rule.max}%)
                    </label>
                    <input
                      type="number"
                      min={rule.min}
                      max={rule.max}
                      step="0.01"
                      className="w-full border border-slate-300 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={mapelWeightForm[rule.key] ?? ''}
                      onChange={(e) => setMapelWeightForm((prev) => ({ ...prev, [rule.key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`px-2.5 py-1 rounded-full border ${
                    mapelWeightValidation.isValid
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-red-50 text-red-700 border-red-200'
                  }`}
                >
                  Total bobot: {mapelWeightValidation.total}%
                </span>
                {selectedMapelWeightRow?.updated_at && (
                  <span className="px-2.5 py-1 rounded-full border bg-slate-50 text-slate-600 border-slate-200">
                    Tersimpan: {new Date(selectedMapelWeightRow.updated_at).toLocaleString('id-ID')}
                  </span>
                )}
                {!mapelWeightValidation.isValid && (
                  <span className="text-red-600">{mapelWeightValidation.errors[0]}</span>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 leading-relaxed">
                <p>Nilai akhir wali kelas dihitung adil dengan 3 tahap:</p>
                <p>1. Nilai akhir per mapel berbobot komponen di atas.</p>
                <p>2. Normalisasi adil: komponen yang belum punya nilai tidak dihitung penyebutnya.</p>
                <p>3. Rata akademik = rata-rata nilai akhir mapel yang punya data.</p>
                <p>4. Nilai akhir wali = rata berbobot (akademik + absensi) sesuai kebijakan ranking sekolah.</p>
                <p>
                  Batas resmi komponen: Tugas/PR 20-40%, Quiz Reguler 10-30%, Quiz UTS 20-30%, Quiz UAS 30-40%,
                  total wajib tepat 100%.
                </p>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={savingMapelWeight || !mapelWeightValidation.isValid}
                  onClick={handleSaveMapelWeight}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {savingMapelWeight ? 'Menyimpan...' : 'Simpan Bobot Mapel'}
                </button>
              </div>
            </div>
          )}
          </div>
        )}

        {/* === TABS === */}
        <div className="flex flex-wrap gap-1 bg-slate-200 p-1.5 rounded-2xl w-fit print:hidden">
          <button
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${activeTab === 'absensi'
              ? 'bg-white shadow text-blue-700'
              : 'text-gray-600 hover:bg-slate-300'
              }`}
            onClick={() => setActiveTab('absensi')}
          >
            Absensi
          </button>
          <button
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${activeTab === 'tugas'
              ? 'bg-white shadow text-blue-700'
              : 'text-gray-600 hover:bg-slate-300'
              }`}
            onClick={() => setActiveTab('tugas')}
          >
            Nilai Tugas
          </button>
          <button
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${activeTab === 'quiz'
              ? 'bg-white shadow text-blue-700'
              : 'text-gray-600 hover:bg-slate-300'
              }`}
            onClick={() => setActiveTab('quiz')}
          >
            Nilai Quiz
          </button>
          {waliKelasList.length > 0 && (
            <>
              <button
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${activeTab === 'rekap'
                  ? 'bg-white shadow text-blue-700'
                  : 'text-gray-600 hover:bg-slate-300'
                  }`}
                onClick={() => setActiveTab('rekap')}
              >
                Rekap Wali Kelas
              </button>
              <button
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${activeTab === 'rekap_eskul'
                  ? 'bg-white shadow text-blue-700'
                  : 'text-gray-600 hover:bg-slate-300'
                  }`}
                onClick={() => setActiveTab('rekap_eskul')}
              >
                Rekap Ekstrakurikuler Siswa
              </button>
            </>
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
        {!rekapWaliData && isRekapTab && (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300">
            <p className="text-gray-500">
              Silakan pilih Bulan untuk melihat {activeTab === 'rekap_eskul' ? 'rekap ekstrakurikuler siswa' : 'rekap wali kelas'}.
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
                          className={`px-1 py-3 text-center w-8 border-l border-gray-200 ${isSun ? 'bg-red-100 text-red-600' : ''
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
                  {filteredAbsensiSiswa.map((s, idx) => {
                    const isRowSelected = selectedAbsensiRowId === s.id
                    return (
                    <tr
                      key={s.id}
                      onClick={() =>
                        setSelectedAbsensiRowId((prev) => (prev === s.id ? null : s.id))
                      }
                      className={buildSelectableRowClass(isRowSelected)}
                    >
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
                            className={`px-1 py-2 text-center border-l border-gray-100 ${isSun ? 'bg-red-50' : ''
                              }`}
                          >
                            {st ? (
                              <span
                                className={`font-bold ${st === 'Hadir'
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
                    )
                  })}
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
                        <span className="block">T{i + 1}</span>
                        <span className="block mt-0.5 text-[10px] leading-tight font-medium normal-case tracking-normal text-slate-500">
                          {formatMiniDate(t.deadline || t.mulai || t.created_at)}
                        </span>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center bg-blue-50">Rata</th>
                    <th className="px-4 py-3 text-center bg-purple-50">
                      Grade
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tugasData.siswa.map((s, idx) => {
                    const isRowSelected = selectedTugasRowId === s.id
                    return (
                    <tr
                      key={s.id}
                      onClick={() =>
                        setSelectedTugasRowId((prev) => (prev === s.id ? null : s.id))
                      }
                      className={buildSelectableRowClass(isRowSelected)}
                    >
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
                                className={`w-12 text-center border-2 rounded px-1 outline-none ${isNilaiRendah
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
                    )
                  })}
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
                    {quizData.quizzes.map((q, i) => {
                      const specialLabel = getQuizSpecialLabel(q)
                      const isSpecialQuiz = Boolean(specialLabel)
                      return (
                        <th
                          key={q.id}
                          className={`px-2 py-3 text-center min-w-[72px] ${
                            isSpecialQuiz
                              ? 'bg-orange-100 text-orange-800'
                              : ''
                          }`}
                          title={q.nama || getQuizColumnLabel(q, i)}
                        >
                          <span className="block">{getQuizColumnLabel(q, i)}</span>
                          <span className={`block mt-0.5 text-[10px] leading-tight font-medium normal-case tracking-normal ${
                            isSpecialQuiz ? 'text-orange-700' : 'text-slate-500'
                          }`}>
                            {formatMiniDate(q.starts_at || q.deadline_at || q.created_at)}
                          </span>
                        </th>
                      )
                    })}
                    <th className="px-4 py-3 text-center bg-blue-50">Rata</th>
                    <th className="px-4 py-3 text-center bg-purple-50">
                      Grade
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {quizData.siswa.map((s, idx) => {
                    const isRowSelected = selectedQuizRowId === s.id
                    return (
                    <tr
                      key={s.id}
                      onClick={() =>
                        setSelectedQuizRowId((prev) => (prev === s.id ? null : s.id))
                      }
                      className={buildSelectableRowClass(isRowSelected)}
                    >
                      <td className="px-4 py-2 text-center">{idx + 1}</td>
                      <td className="px-4 py-2 font-medium">{s.nama}</td>
                      {quizData.quizzes.map((q) => {
                        const nilaiSiswa = s.nilaiQuiz[q.id]?.nilai
                        const isSpecialQuiz = Boolean(getQuizSpecialLabel(q))
                        const isNilaiRendah =
                          nilaiSiswa !== null &&
                          nilaiSiswa !== undefined &&
                          nilaiSiswa !== '-' &&
                          !Number.isNaN(Number(nilaiSiswa)) &&
                          Number(nilaiSiswa) < 70
                        return (
                          <td
                            key={q.id}
                            className={`px-1 py-1 text-center ${isSpecialQuiz ? 'bg-orange-50/70' : ''}`}
                          >
                            {editingQuizNilai?.siswaId === s.id &&
                            editingQuizNilai?.quizId === q.id ? (
                              <input
                                autoFocus
                                className={`w-12 text-center border-2 rounded px-1 outline-none ${
                                  isNilaiRendah ? 'border-red-500 text-red-700' : 'border-blue-500'
                                }`}
                                defaultValue={nilaiSiswa ?? ''}
                                onBlur={(e) => updateNilaiQuiz(s.id, q.id, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') e.target.blur()
                                }}
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <div
                                className={`cursor-pointer rounded px-2 py-1 mx-auto w-fit transition ${
                                  isNilaiRendah
                                    ? 'bg-red-100 text-red-700 font-bold'
                                    : getColorClass(nilaiSiswa)
                                } hover:brightness-95`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditingQuizNilai({
                                    siswaId: s.id,
                                    quizId: q.id
                                  })
                                }}
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
                    )
                  })}
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
                  Total mapel: {rekapWaliData.totalMapel || 0} •
                  Total pertemuan absensi: {rekapWaliData.totalPertemuanKelas || 0}
                </div>
                <div className="text-[11px] text-gray-500">
                  Sesi tanpa catatan absensi siswa dihitung sebagai Alpha pada rekap.
                </div>
                <div className="text-[11px] text-gray-500">
                  Bobot nilai akhir wali: Akademik {(rekapWaliData.policy?.weights?.tugas ?? 40) + (rekapWaliData.policy?.weights?.quiz ?? 40)}%
                  • Absensi {rekapWaliData.policy?.weights?.absensi ?? 20}%.
                </div>
                <div className="text-[11px] text-gray-500">
                  Urutan tie-break resmi: {rekapWaliData.policy?.tieBreakText || '-'}.
                  Mapel inti: {rekapWaliData.policy?.coreMapelText || 'Tidak diatur'}.
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
                {rekapWaliData.ringkasanAkademik && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="px-2.5 py-1 rounded-full text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-200">
                      Rata akhir kelas: {rekapWaliData.ringkasanAkademik.rataNilaiAkhir}
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-[11px] bg-cyan-50 text-cyan-700 border border-cyan-200">
                      Median: {rekapWaliData.ringkasanAkademik.medianNilaiAkhir}
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Tertinggi: {rekapWaliData.ringkasanAkademik.nilaiTertinggi}
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-[11px] bg-slate-50 text-slate-700 border border-slate-200">
                      Terendah: {rekapWaliData.ringkasanAkademik.nilaiTerendah}
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-[11px] bg-green-50 text-green-700 border border-green-200">
                      Tuntas: {rekapWaliData.ringkasanAkademik.jumlahTuntas} ({rekapWaliData.ringkasanAkademik.persenKetuntasanKelas}%)
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-[11px] bg-red-50 text-red-700 border border-red-200">
                      Remedial: {rekapWaliData.ringkasanAkademik.jumlahRemedial}
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-[11px] bg-amber-50 text-amber-700 border border-amber-200">
                      Pendampingan: {rekapWaliData.ringkasanAkademik.jumlahPerluPendampingan}
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-[11px] bg-orange-50 text-orange-700 border border-orange-200">
                      Intervensi intensif: {rekapWaliData.ringkasanAkademik.jumlahIntervensiIntensif}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <button
                  onClick={exportRekapWaliToExcel}
                  className="text-xs bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700"
                >
                  Excel Akademik
                </button>
                <button
                  onClick={exportRekapEskulToExcel}
                  className="text-xs bg-emerald-600 text-white px-3 py-2 rounded hover:bg-emerald-700"
                >
                  Excel Ekskul
                </button>
                <button
                  onClick={() => exportToGoogleSheets('rekap')}
                  className="text-xs bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700"
                >
                  Sheets Akademik
                </button>
                <button
                  onClick={() => exportToGoogleSheets('rekap_eskul')}
                  className="text-xs bg-sky-600 text-white px-3 py-2 rounded hover:bg-sky-700"
                >
                  Sheets Ekskul
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
              <select
                value={rekapStatusFilter}
                onChange={(e) => setRekapStatusFilter(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="semua">Semua Status</option>
                <option value="tuntas">Ketuntasan: Tuntas</option>
                <option value="remedial">Ketuntasan: Remedial</option>
                <option value="pendampingan">Tindak lanjut: Pendampingan</option>
                <option value="intensif">Tindak lanjut: Intervensi Intensif</option>
                <option value="belum_data">Belum ada data</option>
              </select>
              {searchRekapWali && !filteredRekapWaliSiswa.length && (
                <span className="text-xs text-red-500">
                  Tidak ada siswa yang cocok dengan "{searchRekapWali}"
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[2500px] text-sm text-left">
                <thead className="bg-gray-100 text-gray-700 uppercase font-bold text-xs">
                  <tr>
                    <th className="px-4 py-3 w-12">Rank</th>
                    <th className="px-4 py-3 min-w-[200px]">Nama</th>
                    <th className="px-4 py-3 min-w-[120px]">NIS</th>
                    <th className="px-3 py-3 text-center min-w-[130px]">Total Tugas</th>
                    <th className="px-3 py-3 text-center min-w-[130px]">Total Quiz</th>
                    <th className="px-3 py-3 text-center min-w-[110px]">Rata Tugas</th>
                    <th className="px-3 py-3 text-center min-w-[110px]">Rata Quiz</th>
                    <th className="px-3 py-3 text-center bg-indigo-50 min-w-[170px]">Rata Akademik (Mapel)</th>
                    <th className="px-3 py-3 text-center bg-cyan-50 min-w-[150px]">Nilai Mapel Inti</th>
                    <th className="px-3 py-3 text-center bg-sky-50 min-w-[140px]">Skor Absensi</th>
                    <th className="px-3 py-3 text-center bg-purple-50 min-w-[180px]">Nilai Akhir Berbobot</th>
                    <th className="px-3 py-3 text-center min-w-[220px]">Predikat</th>
                    <th className="px-3 py-3 text-center min-w-[130px]">Ketuntasan</th>
                    <th className="px-3 py-3 text-center min-w-[210px]">Tindak Lanjut</th>
                    <th className="px-3 py-3 text-center min-w-[320px]">Catatan Wali</th>
                    <th className="px-3 py-3 text-center min-w-[50px]">H</th>
                    <th className="px-3 py-3 text-center min-w-[50px]">I</th>
                    <th className="px-3 py-3 text-center min-w-[50px]">S</th>
                    <th className="px-3 py-3 text-center min-w-[50px]">A</th>
                    <th className="px-3 py-3 text-center min-w-[85px]">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredRekapWaliSiswa.map((s) => {
                    const bottomRank = rankedRekapWaliSiswa[rankedRekapWaliSiswa.length - 1]?.rank
                    const nilaiAkhir = toNumberOrNull(s.nilaiAkhir ?? s.rataRata)
                    const isLow = (nilaiAkhir != null && nilaiAkhir < 70) || s.rank === bottomRank
                    const isRowSelected = selectedRekapRowId === s.id
                    const rekapDefaultClass = `${isLow ? 'bg-red-50/60 ' : ''}hover:bg-gray-50`
                    return (
                      <tr
                        key={s.id}
                        onClick={() =>
                          setSelectedRekapRowId((prev) => (prev === s.id ? null : s.id))
                        }
                        className={buildSelectableRowClass(isRowSelected, rekapDefaultClass)}
                      >
                        <td className={`px-4 py-2 text-center font-bold ${s.rank === 1 ? 'text-emerald-600' : ''}`}>
                          {s.rank}
                        </td>
                        <td className="px-4 py-2 font-medium">{s.nama}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{s.nis}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">{s.totalTugas}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">{s.totalQuiz}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">{s.rataTugas}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">{s.rataQuiz}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">{s.rataAkademik}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">{s.nilaiMapelInti}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">{s.skorAbsensi}</td>
                        <td className={`px-3 py-2 text-center font-semibold whitespace-nowrap ${isLow ? 'text-red-600' : ''}`}>
                          {s.nilaiAkhir ?? s.rataRata}
                        </td>
                        <td className="px-3 py-2 text-left whitespace-normal">{s.predikatAkhir || getPredikatLabel(s.nilaiAkhir ?? s.rataRata)}</td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] border ${
                              s.statusKetuntasan === 'Tuntas'
                                ? 'bg-green-50 text-green-700 border-green-200'
                                : s.statusKetuntasan === 'Remedial'
                                  ? 'bg-red-50 text-red-700 border-red-200'
                                  : 'bg-slate-50 text-slate-600 border-slate-200'
                            }`}
                          >
                            {s.statusKetuntasan || getKetuntasanStatus(s.nilaiAkhir ?? s.rataRata)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-left text-xs text-slate-700 whitespace-normal" title={s.catatanWali || '-'}>
                          {s.statusIntervensi || '-'}
                        </td>
                        <td className="px-3 py-2 text-left text-xs text-slate-700 whitespace-normal min-w-[320px]">
                          {s.catatanWali || '-'}
                        </td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">{s.absensi.Hadir}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">{s.absensi.Izin}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">{s.absensi.Sakit}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">{s.absensi.Alpha}</td>
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
                      <td colSpan={20} className="px-4 py-6 text-center text-sm text-slate-500">
                        Tidak ada data siswa pada hasil pencarian/filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

          </div>
        )}

        {activeTab === 'rekap_eskul' && rekapWaliData && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-wrap gap-3 justify-between items-center bg-slate-50 print:bg-white">
              <div>
                <h3 className="font-bold text-gray-700">
                  Rekap Ekstrakurikuler Siswa - {getNamaKelasFromList(selectedWaliKelas, waliKelasList)}
                </h3>
                <div className="text-xs text-gray-500">
                  Periode: {rekapWaliData.periode} • Total Ekskul Aktif: {rekapWaliData.eskul?.summary?.totalEkskul || 0} •
                  Total keanggotaan: {rekapWaliData.eskul?.summary?.totalKeanggotaanEskul || 0}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <button
                  onClick={exportRekapEskulToExcel}
                  className="text-xs bg-emerald-600 text-white px-3 py-2 rounded hover:bg-emerald-700"
                >
                  Excel Ekskul
                </button>
                <button
                  onClick={() => exportToGoogleSheets('rekap_eskul')}
                  className="text-xs bg-sky-600 text-white px-3 py-2 rounded hover:bg-sky-700"
                >
                  Sheets Ekskul
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

            <div className="px-4 py-4 border-b border-gray-100 bg-white grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">Total Ekskul Aktif</div>
                <div className="mt-1 text-2xl font-bold text-violet-900">{rekapWaliData.eskul?.summary?.totalEkskul || 0}</div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Siswa Ikut Ekskul</div>
                <div className="mt-1 text-2xl font-bold text-emerald-900">{rekapWaliData.eskul?.summary?.siswaIkutEskul || 0}</div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Siswa Tanpa Ekskul</div>
                <div className="mt-1 text-2xl font-bold text-amber-900">{rekapWaliData.eskul?.summary?.siswaTanpaEskul || 0}</div>
              </div>
              <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Total Keanggotaan</div>
                <div className="mt-1 text-2xl font-bold text-sky-900">{rekapWaliData.eskul?.summary?.totalKeanggotaanEskul || 0}</div>
              </div>
            </div>

            <div className="px-4 py-3 border-b border-gray-100 bg-white flex flex-wrap items-center gap-3 print:hidden">
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

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-100 text-gray-700 uppercase font-bold text-xs">
                  <tr>
                    <th className="px-3 py-3 w-10">No</th>
                    <th className="px-3 py-3 min-w-[200px]">Nama</th>
                    <th className="px-3 py-3 min-w-[120px]">NIS</th>
                    <th className="px-3 py-3 text-center min-w-[110px]">Jml Ekskul</th>
                    <th className="px-3 py-3 min-w-[280px]">Daftar Ekskul</th>
                    <th className="px-3 py-3 text-center min-w-[60px]">H</th>
                    <th className="px-3 py-3 text-center min-w-[60px]">I</th>
                    <th className="px-3 py-3 text-center min-w-[60px]">S</th>
                    <th className="px-3 py-3 text-center min-w-[60px]">A</th>
                    <th className="px-3 py-3 text-center min-w-[80px]">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredRekapEskulSiswa.map((s, idx) => {
                    const daftarEkskul = (s.eskul?.eskulList || []).join(', ') || '-'
                    const isRowSelected = selectedEskulRowId === s.id
                    return (
                      <tr
                        key={`${s.id}-ekskul`}
                        onClick={() =>
                          setSelectedEskulRowId((prev) => (prev === s.id ? null : s.id))
                        }
                        className={buildSelectableRowClass(isRowSelected, 'hover:bg-slate-50')}
                      >
                        <td className="px-3 py-2 text-center">{idx + 1}</td>
                        <td className="px-3 py-2 font-medium">{s.nama}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{s.nis}</td>
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
                        <span className="px-2.5 py-1 rounded-full text-[11px] bg-green-50 text-green-700 border border-green-200">
                          Mapel tuntas: {detailSiswaData.summary.mapelTuntas}
                        </span>
                        <span className="px-2.5 py-1 rounded-full text-[11px] bg-red-50 text-red-700 border border-red-200">
                          Mapel remedial: {detailSiswaData.summary.mapelRemedial}
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
                            <th className="px-3 py-2 text-center">Ketuntasan</th>
                            <th className="px-3 py-2 text-center">Tindak Lanjut</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(detailSiswaData?.rows || []).length === 0 ? (
                            <tr>
                              <td colSpan={10} className="px-3 py-8 text-center text-slate-500">
                                Belum ada data nilai per mata pelajaran pada periode ini.
                              </td>
                            </tr>
                          ) : (
                            detailSiswaData.rows.map((row, idx) => {
                              const rowKey = `${row.mapel}-${idx}`
                              const isRowSelected = selectedDetailNilaiRowKey === rowKey
                              return (
                              <tr
                                key={rowKey}
                                onClick={() =>
                                  setSelectedDetailNilaiRowKey((prev) =>
                                    prev === rowKey ? null : rowKey
                                  )
                                }
                                className={buildSelectableRowClass(isRowSelected, 'hover:bg-slate-50/80')}
                              >
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
                                <td className="px-3 py-2 text-center">
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[11px] border ${
                                      row.statusKetuntasan === 'Tuntas'
                                        ? 'bg-green-50 text-green-700 border-green-200'
                                        : row.statusKetuntasan === 'Remedial'
                                          ? 'bg-red-50 text-red-700 border-red-200'
                                          : 'bg-slate-50 text-slate-600 border-slate-200'
                                    }`}
                                  >
                                    {row.statusKetuntasan}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-left text-xs text-slate-700">{row.tindakLanjutMapel}</td>
                              </tr>
                              )
                            })
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

