// src/pages/guru/LaporanRekap.jsx
import React, { startTransition, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SlidersHorizontal, X } from 'lucide-react'
import { queryClient, queryKeys } from '../../lib/queryClient'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { loadExcelJsBrowser } from '../../utils/excelBrowser'
import { sortStudentsByAttendanceOrder } from '../../utils/studentOrdering'
import AcademicPeriodArchiveFilter from '../../components/AcademicPeriodArchiveFilter'
import useActiveAcademicPeriod from '../../hooks/useActiveAcademicPeriod'
import { filterSchedulesForSemester } from '../../utils/schedulePeriodScope'
import {
  scheduleService,
} from '../../services/scheduleService'
import {
  gradeService
} from '../../services/gradeService'
import { assignmentService, submissionService } from '../../services/assignmentService'
import { quizService } from '../../services/quizService'
import { reportCardService } from '../../services/reportCardService'
import { reportService } from '../../services/reportService'
import { ClassesApi } from '../../lib/api/v2/classes'
import {
  getAcademicAssessmentLabels,
  getAssessmentSlotLabel
} from '../../utils/academicAssessment'
import {
  getKelasDisplayName,
  getNamaKelasFromList,
  getDatesInPeriod,
  isSunday,
  getGrade,
  getPredikatLabel,
  getKetuntasanStatus,
  getIntervensiStatus,
  buildCatatanWaliOtomatis,
  hitungStatistikNilai,
  getColorClass,
  bulanList,
  KKM_NILAI_TUGAS,
  DEFAULT_RANKING_POLICY,
  MAPEL_COMPONENT_WEIGHT_RULES,
  DEFAULT_MAPEL_COMPONENT_WEIGHTS,
  MAPEL_ASSESSMENT_SOURCE_MANUAL,
  MAPEL_MANUAL_COMPONENT_ATTENDANCE,
  MAPEL_MANUAL_COMPONENT_BONUS,
  MAPEL_MANUAL_COMPONENT_OTHER,
  getMapelManualComponentLabel,
  round2,
  autoFitWorksheetColumns,
  buildSelectableRowClass,
  makeLocalId,
  normalizeQuizMode,
  normalizeMapelName,
  normalizeMapelKey,
  hitungSkorAbsensiWali,
  toNumberOrNull,
  normalizeMapelComponentWeights,
  getMapelWeightValidation,
  describeRankingPolicy,
  formatMiniDate,
  hitungRataSederhana,
  hitungNilaiMapelBerbobot,
  hitungRataAkhirWali,
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

const toArray = (value) => {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.data)) return value.data
  if (Array.isArray(value?.rows)) return value.rows
  if (Array.isArray(value?.items)) return value.items
  return []
}

const normalizeTeacherSummaryData = (data) => ({
  ...(data || {}),
  siswa: sortStudentsByAttendanceOrder(toArray(data?.siswa)),
  tugas: toArray(data?.tugas),
  quiz: toArray(data?.quiz),
  dateStrings: toArray(data?.dateStrings)
})

const getCurrentMonthValue = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const getAcademicYearStartValue = (tahunAjaran = '') => {
  const match = String(tahunAjaran || '').match(/^(\d{4})/)
  return match ? Number(match[1]) : 0
}

const getQuizSpecialLabel = (quiz, fallbackSemester = '') => {
  const mode = normalizeQuizMode(quiz)
  const name = String(quiz?.nama || quiz?.judul || quiz?.title || '').trim().toLowerCase()

  if (mode === 'uas' || /\b(uas|pas|ukk|pat)\b|ujian (akhir semester|kenaikan kelas)/.test(name)) {
    return getAssessmentSlotLabel('uas', quiz?.semester || fallbackSemester)
  }
  if (mode === 'uts' || /\b(uts|pts)\b|ujian tengah semester/.test(name)) {
    return getAssessmentSlotLabel('uts', quiz?.semester || fallbackSemester)
  }
  return ''
}

const getQuizColumnLabel = (quiz, index, fallbackSemester = '') => {
  const specialLabel = getQuizSpecialLabel(quiz, fallbackSemester)
  return specialLabel ? `Q${index + 1} ${specialLabel}` : `Q${index + 1}`
}

// ==============================
// ===== MAIN COMPONENT =========
// ==============================
export default function LaporanRekap() {
  const { user } = useAuthStore()
  const { pushToast, setLoading } = useUIStore()
  const [searchParams] = useSearchParams()

  // -- Persist filter state in localStorage --
  const FILTER_STORAGE_KEY = 'edusmart.guru.laporan.filters'
  const savedFilters = useMemo(() => {
    try {
      const raw = window.localStorage.getItem(FILTER_STORAGE_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  }, [])

  // -- UI State --
  const [activeTab, setActiveTab] = useState(() => {
    const tab = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : ''
    ).get('tab')
    if (['absensi', 'tugas', 'quiz', 'mapel', 'rekap', 'rekap_eskul'].includes(tab)) return tab
    if (savedFilters.activeTab && ['absensi', 'tugas', 'quiz', 'mapel', 'rekap', 'rekap_eskul'].includes(savedFilters.activeTab)) return savedFilters.activeTab
    return 'absensi'
  })
  const isRekapTab = activeTab === 'rekap' || activeTab === 'rekap_eskul'
  const [showBulanDropdown, setShowBulanDropdown] = useState(false)
  const dropdownRef = useRef(null)
  const reportRequestSeqRef = useRef(0)

  // -- Data Filter State --
  const [kelasList, setKelasList] = useState([])
  const [waliKelasList, setWaliKelasList] = useState([])
  const [selectedWaliKelas, setSelectedWaliKelas] = useState(savedFilters.selectedWaliKelas || '')
  const [jadwalGuru, setJadwalGuru] = useState([])
  const [mapelList, setMapelList] = useState([])
  const [mapelComponentWeightRows, setMapelComponentWeightRows] = useState([])
  const [selectedWeightMapel, setSelectedWeightMapel] = useState('')
  const [mapelWeightForm, setMapelWeightForm] = useState({ ...DEFAULT_MAPEL_COMPONENT_WEIGHTS })
  const [showMapelWeightOverlay, setShowMapelWeightOverlay] = useState(false)
  const [savingMapelWeight, setSavingMapelWeight] = useState(false)

  // -- Selection State (Restore from saved or default) --
  const [selectedKelas, setSelectedKelas] = useState(savedFilters.selectedKelas || '')
  const [selectedMapel, setSelectedMapel] = useState(savedFilters.selectedMapel || '')
  const [selectedBulan, setSelectedBulan] = useState(() => {
    if (Array.isArray(savedFilters.selectedBulan) && savedFilters.selectedBulan.length) return savedFilters.selectedBulan
    return [getCurrentMonthValue()]
  }) // Default: bulan berjalan atau saved
  const [tahun, setTahun] = useState(new Date().getFullYear())
  const {
    activeAcademicPeriod,
    academicYearOptions,
	    isViewingArchivePeriod,
	    period: reportPeriod,
	    dateFilterPeriod,
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
  const [mapelReportData, setMapelReportData] = useState(null)
  const [mapelManualDrafts, setMapelManualDrafts] = useState({})
  const [savingMapelManualId, setSavingMapelManualId] = useState('')
  const [mapelRapotTargetType, setMapelRapotTargetType] = useState('uts')
  const [sendingMapelToWali, setSendingMapelToWali] = useState(false)
  const [rekapWaliData, setRekapWaliData] = useState(null)
  const [reportLoadingKey, setReportLoadingKey] = useState('')
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

  const getMapelManualPreview = useCallback((row) => {
    if (!row || !mapelReportData) {
      return {
        manualScore: null,
        manualWeighted: 0,
        midtermScore: row?.quizUts ?? null,
        midtermWeighted: 0,
        finalScore: row?.quizUas ?? null,
        finalWeighted: 0,
        nilaiAkhir: row?.nilaiAkhir ?? null,
        invalid: false
      }
    }

    const draft = mapelManualDrafts[row.id] || {}
    const weight = mapelReportData.bobot || DEFAULT_MAPEL_COMPONENT_WEIGHTS
    const usesManualMidterm = weight.sumber_uts === MAPEL_ASSESSMENT_SOURCE_MANUAL
    const usesManualFinal = weight.sumber_uas === MAPEL_ASSESSMENT_SOURCE_MANUAL
    const hasMidtermValue = draft.nilai_uts_manual !== '' && draft.nilai_uts_manual !== null && draft.nilai_uts_manual !== undefined
    const hasFinalValue = draft.nilai_uas_manual !== '' && draft.nilai_uas_manual !== null && draft.nilai_uas_manual !== undefined
    const hasDraftValue = draft.nilai_manual !== '' && draft.nilai_manual !== null && draft.nilai_manual !== undefined
    const midtermManualScore = hasMidtermValue ? toNumberOrNull(draft.nilai_uts_manual) : null
    const finalManualScore = hasFinalValue ? toNumberOrNull(draft.nilai_uas_manual) : null
    const manualScore = hasDraftValue ? toNumberOrNull(draft.nilai_manual) : null
    const sisaBobot = Number(mapelReportData.sisaBobot || 0)
    const invalidMidterm = usesManualMidterm && hasMidtermValue && (midtermManualScore == null || midtermManualScore < 0 || midtermManualScore > 100)
    const invalidFinal = usesManualFinal && hasFinalValue && (finalManualScore == null || finalManualScore < 0 || finalManualScore > 100)
    const invalidManual = sisaBobot > 0 && hasDraftValue && (manualScore == null || manualScore < 0 || manualScore > 100)
    const invalid = invalidMidterm || invalidFinal || invalidManual
    const midtermWeighted = usesManualMidterm && !invalidMidterm && midtermManualScore != null
      ? midtermManualScore * Number(weight.bobot_quiz_uts || 0) / 100
      : 0
    const finalWeighted = usesManualFinal && !invalidFinal && finalManualScore != null
      ? finalManualScore * Number(weight.bobot_quiz_uas || 0) / 100
      : 0
    const manualWeighted = !invalidManual && manualScore != null && sisaBobot > 0
      ? manualScore * sisaBobot / 100
      : 0
    const baseScore = Number(row.baseScore || 0)
    const hasAnyScore = row.hasAnyScore
      || (usesManualMidterm && midtermManualScore != null && !invalidMidterm)
      || (usesManualFinal && finalManualScore != null && !invalidFinal)
      || (sisaBobot > 0 && manualScore != null && !invalidManual)

    return {
      manualScore,
      manualWeighted,
      midtermScore: usesManualMidterm ? midtermManualScore : row.quizUts,
      midtermWeighted,
      finalScore: usesManualFinal ? finalManualScore : row.quizUas,
      finalWeighted,
      nilaiAkhir: hasAnyScore ? round2(baseScore + midtermWeighted + finalWeighted + manualWeighted) : null,
      invalidMidterm,
      invalidFinal,
      invalidManual,
      invalid
    }
  }, [mapelManualDrafts, mapelReportData])

  // Pencarian siswa di tab Absensi
  const [searchNama, setSearchNama] = useState('')
  const [searchRekapWali, setSearchRekapWali] = useState('')
  const [rekapStatusFilter, setRekapStatusFilter] = useState('semua')
  const [searchRekapEskul, setSearchRekapEskul] = useState('')

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (['absensi', 'tugas', 'quiz', 'mapel', 'rekap', 'rekap_eskul'].includes(tab) && tab !== activeTab) {
      setActiveTab(tab)
    }
  }, [activeTab, searchParams])

  const reportPeriodLabel = `${reportPeriod.tahunAjaran} - Tahun Ajaran`
  const isActiveReportPeriod = !isViewingArchivePeriod
  const reportLoadingLabel = useMemo(() => {
    if (reportLoadingKey === 'absensi') return 'Memuat rekap absensi...'
    if (reportLoadingKey === 'tugas') return 'Memuat rekap tugas...'
    if (reportLoadingKey === 'quiz') return 'Memuat rekap quiz...'
    if (reportLoadingKey === 'mapel') return 'Memuat laporan mapel...'
    if (reportLoadingKey === 'rekap') return 'Memuat rekap wali kelas...'
    return ''
  }, [reportLoadingKey])
  const selectedTahunAjaran = selectedAcademicPeriodPayload.tahun_ajaran
  const selectedSemester = selectedAcademicPeriodPayload.semester
  const assessmentLabels = useMemo(
    () => getAcademicAssessmentLabels(selectedSemester || reportPeriod.semester),
    [reportPeriod.semester, selectedSemester]
  )
  const mapelRapotTargetLabel = mapelRapotTargetType === 'uas'
    ? assessmentLabels.final.short
    : assessmentLabels.midterm.short
  const selectedMapelWeightPeriodKey = `${selectedTahunAjaran || ''}|${selectedSemester || ''}`
  const selectedPeriodStartYear = getAcademicYearStartValue(selectedTahunAjaran)
  const activePeriodStartYear = getAcademicYearStartValue(activeAcademicPeriod?.tahunAjaran)
  const isFutureReportPeriod = selectedPeriodStartYear > 0 &&
    activePeriodStartYear > 0 &&
    selectedPeriodStartYear > activePeriodStartYear
  const mapelWeightPeriodLabel = `${selectedTahunAjaran || 'Periode belum dipilih'}${selectedSemester ? ` - Semester ${selectedSemester}` : ''}`
  const mapelWeightPeriodTone = isFutureReportPeriod
    ? 'future'
    : isViewingArchivePeriod
      ? 'archive'
      : 'active'
  const startReportLoad = useCallback((loadingKey = '') => {
    const requestId = reportRequestSeqRef.current + 1
    reportRequestSeqRef.current = requestId
    setReportLoadingKey(loadingKey)
    return requestId
  }, [])
  const isCurrentReportLoad = useCallback(
    (requestId) => reportRequestSeqRef.current === requestId,
    []
  )
  const finishReportLoad = useCallback((requestId, loadingKey) => {
    if (reportRequestSeqRef.current !== requestId) return
    setReportLoadingKey((current) => current === loadingKey ? '' : current)
  }, [])
  const reportMonthOptions = useMemo(
    () => ((dateFilterPeriod.months?.length ? dateFilterPeriod.months : reportPeriod.months) || []).map((month) => ({
      value: month.value,
      label: month.label,
      month: String(month.month).padStart(2, '0'),
      year: month.year
    })),
    [dateFilterPeriod.months, reportPeriod.months]
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

  // Tables that are already scoped by parent IDs (tugas_id IN [...]) — do NOT
  // add extra tahun_ajaran filter here because the column is frequently null
  // for older answer records, causing all historical data to vanish silently.
  const SKIP_TAHUN_AJARAN_FILTER_TABLES = useMemo(
    () => new Set([
      'tugas_jawaban',
      'quiz_submissions',
      'quiz_answers',
    ]),
    []
  )

  const applyReportAcademicFilters = useCallback(
    (query, tableHint = '') => {
      // Skip for child tables that are scoped via parent IDs already
      if (tableHint && SKIP_TAHUN_AJARAN_FILTER_TABLES.has(tableHint)) return query
      let next = query
      if (reportPeriod.tahunAjaran) next = next.eq('tahun_ajaran', reportPeriod.tahunAjaran)
      return next
    },
    [reportPeriod.tahunAjaran, SKIP_TAHUN_AJARAN_FILTER_TABLES]
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

  // -- Persist filters to localStorage on change --
  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
        activeTab,
        selectedKelas,
        selectedMapel,
        selectedBulan,
        selectedWaliKelas
      }))
    } catch { /* quota exceeded or private mode */ }
  }, [activeTab, selectedKelas, selectedMapel, selectedBulan, selectedWaliKelas])

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
        const jadwalRequest = scheduleService.listTeacherSchedules({ tahun_ajaran: reportPeriod.tahunAjaran, semester: reportPeriod.semester })
        const tugasRequest = assignmentService.getAssignments({ tahun_ajaran: reportPeriod.tahunAjaran, semester: reportPeriod.semester, per_page: 1000 })
        const quizRequest = quizService.listQuizzes({
          tahun_ajaran: reportPeriod.tahunAjaran,
          semester: reportPeriod.semester,
          per_page: 1000
        }).then((data) => ({ data: data || [] }))

        const [jadwalResult, tugasResult, quizResult] = await Promise.all([
          jadwalRequest,
          tugasRequest,
          quizRequest
        ])
	        if (jadwalResult?.error) throw jadwalResult.error
	        if (tugasResult?.error) throw tugasResult.error
	        if (quizResult?.error) throw quizResult.error
	        const rows = [
	          ...(jadwalResult?.data || []),
	          ...(tugasResult?.data || []).map((row) => ({
	            kelas_id: row.kelas,
	            mapel: row.mapel,
	            source: 'tugas'
	          })),
	          ...(quizResult?.data || []).map((row) => ({
	            kelas_id: row.kelas_id,
	            mapel: row.mapel,
	            source: 'quiz'
	          }))
	        ].filter((row) => String(row?.mapel || '').trim())
	        setJadwalGuru(rows)
	      } catch (e) {
        console.error(e)
      }
    }
    load()
  }, [applyReportAcademicFilters, reportPeriod.semester, reportPeriod.tahunAjaran, user?.id])

  useEffect(() => {
    const loadWaliKelas = async () => {
      if (!user?.id) return

      try {
        const data = await reportService.homeroomOptions({
          tahun_ajaran: reportPeriod.tahunAjaran
        })
        const sorted = (data || []).sort((a, b) =>
          getKelasDisplayName(a).localeCompare(getKelasDisplayName(b))
        )
        setWaliKelasList(sorted)
        if (!selectedWaliKelas && sorted.length) setSelectedWaliKelas(sorted[0].id)
      } catch (e) {
        console.error(e)
      }
    }
    loadWaliKelas()
  }, [reportPeriod.tahunAjaran, selectedWaliKelas, user?.id])

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

        const res = await ClassesApi.getAll()
        const allData = res.data || []
        const data = allData.filter(k => kelasIds.includes(k.id))
        const sorted = (data || []).sort((a, b) =>
          getKelasDisplayName(a).localeCompare(getKelasDisplayName(b))
        )
        setKelasList(sorted)
        setSelectedKelas((prev) => {
          if (prev && sorted.some((k) => String(k.id) === String(prev))) return prev
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
    let mapels = jadwalGuru
      .filter((j) => String(j.kelas_id || '') === String(selectedKelas || '') && j.mapel)
      .map((j) => j.mapel)
      .filter((v, i, s) => s.indexOf(v) === i)
      .sort()
    if (!mapels.length) {
      mapels = jadwalGuru
        .filter((j) => j.mapel)
        .map((j) => j.mapel)
        .filter((v, i, s) => s.indexOf(v) === i)
        .sort()
    }
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
        const result = await gradeService.listWeights({
          tahun_ajaran: selectedTahunAjaran,
          semester: selectedSemester,
          per_page: 100
        })
        setMapelComponentWeightRows(result.data || [])
      } catch (error) {
        console.error('Gagal memuat bobot komponen mapel:', error)
        setMapelComponentWeightRows([])
      }
    }

    loadMapelComponentWeights()
  }, [selectedMapelWeightPeriodKey, selectedSemester, selectedTahunAjaran, user?.id])

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
    ;(mapelList || []).forEach((item) => {
      const mapel = normalizeMapelName(item)
      const key = normalizeMapelKey(mapel)
      if (!key) return
      if (!dedup.has(key)) {
        dedup.set(key, mapel)
      }
    })
    ;(mapelComponentWeightRows || []).forEach((item) => {
      const mapel = normalizeMapelName(item?.mapel)
      const key = normalizeMapelKey(mapel)
      if (!key) return
      if (!dedup.has(key)) {
        dedup.set(key, mapel)
      }
    })
    return Array.from(dedup.values()).sort((a, b) => String(a || '').localeCompare(String(b || ''), 'id'))
  }, [jadwalGuru, mapelComponentWeightRows, mapelList])

  const mapelWeightByMapelKey = useMemo(() => {
    const lookup = new Map()
    ;(mapelComponentWeightRows || []).forEach((row) => {
      const mapelKey = normalizeMapelKey(row?.mapel)
      if (!mapelKey) return
      if (!lookup.has(mapelKey)) {
        lookup.set(mapelKey, normalizeMapelComponentWeights(row))
      }
    })
    return lookup
  }, [mapelComponentWeightRows])
  const mapelWeightedKeySet = useMemo(
    () => new Set(Array.from(mapelWeightByMapelKey.keys())),
    [mapelWeightByMapelKey]
  )
  const hasAnySavedMapelWeightForPeriod = mapelWeightedKeySet.size > 0
  const mapelWeightSetupMessage = !mapelAmpuOptions.length
    ? 'Belum ada mapel yang terdeteksi pada periode ini.'
    : hasAnySavedMapelWeightForPeriod
      ? ''
      : isFutureReportPeriod
        ? 'Periode depan dimulai dari default. Silakan set bobot nilai untuk periode ini sebelum dipakai.'
        : isViewingArchivePeriod
          ? 'Belum ada bobot nilai tersimpan untuk periode arsip ini. Jika guru belum pernah set pada periode tersebut, sistem memakai default.'
          : 'Bobot nilai periode ini belum pernah diset. Silakan lakukan pengaturan bobot nilai.'

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
  const getNilaiToneClass = useCallback((nilai) => {
    const parsed = toNumberOrNull(nilai)
    if (parsed == null) return 'bg-slate-50 text-slate-500 border-slate-200'
    if (parsed < KKM_NILAI_TUGAS) return 'bg-red-50 text-red-700 border-red-200'
    if (parsed >= 90) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    return 'bg-amber-50 text-amber-700 border-amber-200'
  }, [])
  const selectedMapelWeightRow = useMemo(() => {
    if (!selectedWeightMapel) return null
    const selectedMapelKey = normalizeMapelKey(selectedWeightMapel)
    return (mapelComponentWeightRows || []).find(
      (row) => normalizeMapelKey(row?.mapel) === selectedMapelKey
    ) || null
  }, [selectedWeightMapel, mapelComponentWeightRows])

  const handleSaveMapelWeight = useCallback(async () => {
    if (!user?.id) return
    if (!selectedTahunAjaran) {
      pushToast('error', 'Pilih periode laporan terlebih dahulu.')
      return
    }
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
      tahun_ajaran: selectedTahunAjaran,
      semester: selectedSemester || '',
      bobot_tugas_pr: mapelWeightValidation.normalized.bobot_tugas_pr,
      bobot_quiz_reguler: mapelWeightValidation.normalized.bobot_quiz_reguler,
      bobot_quiz_uts: mapelWeightValidation.normalized.bobot_quiz_uts,
      bobot_quiz_uas: mapelWeightValidation.normalized.bobot_quiz_uas,
      sumber_uts: mapelWeightValidation.normalized.sumber_uts,
      sumber_uas: mapelWeightValidation.normalized.sumber_uas,
      jenis_manual: mapelWeightValidation.normalized.jenis_manual,
      label_manual: mapelWeightValidation.normalized.label_manual || null,
      created_at: existing?.created_at || nowIso,
      updated_at: nowIso
    }

    try {
      setSavingMapelWeight(true)
      if (!isActiveReportPeriod || isFutureReportPeriod) {
        throw new Error('Periode arsip atau periode depan tidak dapat diubah tanpa konteks mutasi resmi.')
      }
      const result = await gradeService.saveWeight(payload)
      const savedRow = result.data || payload

      setMapelComponentWeightRows((prev) => {
        const others = [...(prev || [])].filter((row) => normalizeMapelKey(row?.mapel) !== selectedMapelKey)
        return [savedRow, ...others]
      })
      setMapelWeightForm({
        bobot_tugas_pr: savedRow.bobot_tugas_pr,
        bobot_quiz_reguler: savedRow.bobot_quiz_reguler,
        bobot_quiz_uts: savedRow.bobot_quiz_uts,
        bobot_quiz_uas: savedRow.bobot_quiz_uas,
        sumber_uts: savedRow.sumber_uts || 'digital',
        sumber_uas: savedRow.sumber_uas || 'digital',
        jenis_manual: savedRow.jenis_manual || MAPEL_MANUAL_COMPONENT_ATTENDANCE,
        label_manual: savedRow.label_manual || ''
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
    selectedTahunAjaran,
    selectedSemester,
    selectedWeightMapel,
    isActiveReportPeriod,
    isFutureReportPeriod,
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
    const values = Object.values(nilaiTugas || {})
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
      startReportLoad()
      setAbsensiData(null)
      return
    }

    const requestId = startReportLoad('absensi')
    try {
      const params = buildTeacherSummaryParams('absensi')
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.reports.attendanceSummary(params),
        queryFn: async () => {
          return normalizeTeacherSummaryData(await reportService.attendanceSummary(params))
        },
        staleTime: 60 * 1000,
      })
      if (!isCurrentReportLoad(requestId)) return
      const normalizedData = normalizeTeacherSummaryData(data)
      startTransition(() => {
        if (isCurrentReportLoad(requestId)) setAbsensiData(normalizedData)
      })
    } catch (e) {
      if (e?.code === 'REQUEST_ABORTED' || !isCurrentReportLoad(requestId)) return
      console.error(e)
      pushToast('error', 'Gagal memuat absensi')
    } finally {
      finishReportLoad(requestId, 'absensi')
    }
  }, [
    buildTeacherSummaryParams,
    finishReportLoad,
    isCurrentReportLoad,
    pushToast,
    selectedBulan,
    selectedKelas,
    selectedMapel,
    startReportLoad,
  ])

  const loadRekapTugas = useCallback(async () => {
    // Syarat: Kelas, Mapel, dan MINIMAL 1 Bulan dipilih
    if (!selectedKelas || !selectedMapel || selectedBulan.length === 0) {
      startReportLoad()
      setTugasData(null)
      return
    }

    const requestId = startReportLoad('tugas')
    try {
      const params = buildTeacherSummaryParams('tugas')
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.reports.taskSummary(params),
        queryFn: async () => {
          return normalizeTeacherSummaryData(await reportService.taskSummary(params))
        },
        staleTime: 60 * 1000,
      })
      if (!isCurrentReportLoad(requestId)) return
      const normalizedData = normalizeTeacherSummaryData(data)
      startTransition(() => {
        if (isCurrentReportLoad(requestId)) setTugasData(normalizedData)
      })
    } catch (e) {
      if (e?.code === 'REQUEST_ABORTED' || !isCurrentReportLoad(requestId)) return
      console.error(e)
      pushToast('error', 'Gagal memuat tugas')
    } finally {
      finishReportLoad(requestId, 'tugas')
    }
  }, [
    buildTeacherSummaryParams,
    finishReportLoad,
    isCurrentReportLoad,
    pushToast,
    selectedBulan,
    selectedKelas,
    selectedMapel,
    startReportLoad,
  ])

  const loadRekapQuiz = useCallback(async () => {
    if (!selectedKelas || !selectedMapel || selectedBulan.length === 0) {
      startReportLoad()
      setQuizData(null)
      return
    }

    const requestId = startReportLoad('quiz')
    try {
      const params = buildTeacherSummaryParams('quiz')
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.reports.quizSummary(params),
        queryFn: async () => {
          return normalizeTeacherSummaryData(await reportService.quizSummary(params))
        },
        staleTime: 60 * 1000,
      })
      if (!isCurrentReportLoad(requestId)) return
      const normalizedData = normalizeTeacherSummaryData(data)
      startTransition(() => {
        if (isCurrentReportLoad(requestId)) setQuizData(normalizedData)
      })
    } catch (e) {
      if (e?.code === 'REQUEST_ABORTED' || !isCurrentReportLoad(requestId)) return
      console.error(e)
      pushToast('error', 'Gagal memuat nilai quiz')
    } finally {
      finishReportLoad(requestId, 'quiz')
    }
  }, [
    buildTeacherSummaryParams,
    finishReportLoad,
    isCurrentReportLoad,
    pushToast,
    selectedBulan,
    selectedKelas,
    selectedMapel,
    startReportLoad,
  ])

  const loadLaporanMapel = useCallback(async () => {
    if (!user?.id || !selectedKelas || !selectedMapel || selectedBulan.length === 0) {
      startReportLoad()
      setMapelReportData(null)
      setMapelManualDrafts({})
      return
    }

    const requestId = startReportLoad('mapel')
    try {
      const kelasNama = getNamaKelasFromList(selectedKelas, kelasList)
      const taskParams = buildTeacherSummaryParams('tugas')
      const quizParams = buildTeacherSummaryParams('quiz')
      const [taskSummary, quizSummary] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: queryKeys.reports.taskSummary(taskParams),
          queryFn: async () => {
            return normalizeTeacherSummaryData(await reportService.taskSummary(taskParams))
          },
          staleTime: 60 * 1000,
        }),
        queryClient.fetchQuery({
          queryKey: queryKeys.reports.quizSummary(quizParams),
          queryFn: async () => {
            return normalizeTeacherSummaryData(await reportService.quizSummary(quizParams))
          },
          staleTime: 60 * 1000,
        })
      ])

      if (!isCurrentReportLoad(requestId)) return

      const taskData = normalizeTeacherSummaryData(taskSummary)
      const quizData = normalizeTeacherSummaryData(quizSummary)
      const tugasRows = toArray(taskData?.tugas)
      const quizRows = toArray(quizData?.quizzes || quizData?.quiz)

      const studentsById = new Map()
      ;[...toArray(taskData?.siswa), ...toArray(quizData?.siswa)].forEach((student) => {
        const id = String(student?.id || '').trim()
        if (!id || studentsById.has(id)) return
        studentsById.set(id, {
          id,
          nama: student?.nama || '-',
          nis: student?.nis || '',
          kelas: student?.kelas || kelasNama || selectedKelas
        })
      })

      const students = sortStudentsByAttendanceOrder(Array.from(studentsById.values()))
      const tahunAjaran = selectedTahunAjaran || reportPeriod.tahunAjaran


      const periodParams = {
        kelas_id: selectedKelas,
        tahun_ajaran: tahunAjaran,
        semester: selectedSemester || reportPeriod.semester,
        mapel: selectedMapel,
        per_page: 500
      }
      const [manualResult, rapotResult] = await Promise.all([
        gradeService.listManualScores(periodParams),
        reportCardService.listReportCards(periodParams)
      ])

      const manualRows = manualResult.data || []
      const rapotRows = rapotResult.data || []

      const rapotByStudent = new Map((rapotRows || []).map((row) => [String(row.siswa_id), row]))

      const sentItemByRapotId = new Map(
        rapotRows
          .flatMap((report) => (report.items || []).map((item) => ({ ...item, rapot_id: report.id })))
          .filter((item) => normalizeMapelKey(item.mapel) === normalizeMapelKey(selectedMapel))
          .map((item) => [String(item.rapot_id), item])
      )

      const bobotMapel = mapelWeightByMapelKey.get(normalizeMapelKey(selectedMapel))
        || { ...DEFAULT_MAPEL_COMPONENT_WEIGHTS }
      const weightValidation = getMapelWeightValidation(bobotMapel)
      const sisaBobot = weightValidation.remaining
      const usesManualMidterm = bobotMapel.sumber_uts === MAPEL_ASSESSMENT_SOURCE_MANUAL
      const usesManualFinal = bobotMapel.sumber_uas === MAPEL_ASSESSMENT_SOURCE_MANUAL
      const jawabanByStudent = new Map()
      ;(taskData.siswa || []).forEach((student) => {
        const key = String(student?.id || '')
        if (!key) return
        const nilaiRows = Object.values(student?.nilaiTugas || {})
        nilaiRows.forEach((item) => {
          const nilai = toNumberOrNull(item?.nilai)
          if (nilai == null) return
          if (!jawabanByStudent.has(key)) jawabanByStudent.set(key, [])
          jawabanByStudent.get(key).push(nilai)
        })
      })

      const quizById = new Map((quizRows || []).map((row) => [String(row.id), row]))
      const quizScoreByStudent = new Map()
      ;(quizData.siswa || []).forEach((student) => {
        const studentId = String(student?.id || '')
        if (!studentId) return
        Object.values(student?.nilaiQuiz || {}).forEach((item) => {
          const quiz = quizById.get(String(item?.quiz_id || ''))
          const nilai = toNumberOrNull(item?.nilai)
          if (nilai == null || !quiz) return
          if (!quizScoreByStudent.has(studentId)) {
            quizScoreByStudent.set(studentId, { regular: [], uts: [], uas: [] })
          }
          const bucket = quizScoreByStudent.get(studentId)
          const mode = normalizeQuizMode(quiz)
          if (mode === 'uas') bucket.uas.push(nilai)
          else if (mode === 'uts') bucket.uts.push(nilai)
          else bucket.regular.push(nilai)
        })
      })

      const manualByStudent = new Map((manualRows || []).map((row) => [String(row.siswa_id), row]))
      const rows = students.map((student) => {
        const taskAvg = hitungRataSederhana(jawabanByStudent.get(String(student.id)) || [])
        const quizBucket = quizScoreByStudent.get(String(student.id)) || { regular: [], uts: [], uas: [] }
        const regularAvg = hitungRataSederhana(quizBucket.regular)
        const utsAvg = hitungRataSederhana(quizBucket.uts)
        const uasAvg = hitungRataSederhana(quizBucket.uas)
        const manualRow = manualByStudent.get(String(student.id)) || null
        const rapotRow = rapotByStudent.get(String(student.id)) || null
        const sentItem = rapotRow?.id ? sentItemByRapotId.get(String(rapotRow.id)) : null
        const manualScore = toNumberOrNull(manualRow?.nilai_manual)
        const manualMidtermScore = toNumberOrNull(manualRow?.nilai_uts_manual)
        const manualFinalScore = toNumberOrNull(manualRow?.nilai_uas_manual)
        const manualWeighted = manualScore != null && sisaBobot > 0 ? manualScore * sisaBobot / 100 : 0
        const manualMidtermWeighted = usesManualMidterm && manualMidtermScore != null
          ? manualMidtermScore * Number(bobotMapel.bobot_quiz_uts || 0) / 100
          : 0
        const manualFinalWeighted = usesManualFinal && manualFinalScore != null
          ? manualFinalScore * Number(bobotMapel.bobot_quiz_uas || 0) / 100
          : 0
        const componentScore =
          (taskAvg != null ? taskAvg * Number(bobotMapel.bobot_tugas_pr || 0) / 100 : 0) +
          (regularAvg != null ? regularAvg * Number(bobotMapel.bobot_quiz_reguler || 0) / 100 : 0) +
          (!usesManualMidterm && utsAvg != null ? utsAvg * Number(bobotMapel.bobot_quiz_uts || 0) / 100 : 0) +
          (!usesManualFinal && uasAvg != null ? uasAvg * Number(bobotMapel.bobot_quiz_uas || 0) / 100 : 0)
        const hasAnyScore = taskAvg != null
          || regularAvg != null
          || (!usesManualMidterm && utsAvg != null)
          || (!usesManualFinal && uasAvg != null)
          || (usesManualMidterm && manualMidtermScore != null)
          || (usesManualFinal && manualFinalScore != null)
          || (sisaBobot > 0 && manualScore != null)
        const totalWeighted = round2(componentScore + manualMidtermWeighted + manualFinalWeighted + manualWeighted)

        return {
          id: student.id,
          nama: student.nama,
          nis: student.nis,
          kelas: isActiveReportPeriod ? student.kelas : (kelasNama || selectedKelas),
          tugasPr: taskAvg,
          quizReguler: regularAvg,
          quizUts: utsAvg,
          quizUas: uasAvg,
          nilaiUtsManual: manualMidtermScore,
          nilaiUasManual: manualFinalScore,
          nilaiManual: manualScore,
          baseScore: round2(componentScore),
          hasAnyScore,
          nilaiAkhir: hasAnyScore ? totalWeighted : null,
          rapotId: rapotRow?.id || null,
          sentToWali: Boolean(sentItem),
          sentAt: sentItem?.sent_at || null,
          rapotLocked: Boolean(rapotRow?.locked_at),
          manualRow,
          catatan: manualRow?.catatan || ''
        }
      })

      const nextDrafts = {}
      rows.forEach((row) => {
        nextDrafts[row.id] = {
          nilai_uts_manual: row.nilaiUtsManual || '',
          nilai_uas_manual: row.nilaiUasManual || '',
          nilai_manual: row.nilaiManual || '',
          catatan: row.catatan || ''
        }
      })

      startTransition(() => {
        if (!isCurrentReportLoad(requestId)) return
        setMapelManualDrafts(nextDrafts)
        setMapelReportData({
          rows,
          mapel: selectedMapel,
          kelas: kelasNama || selectedKelas,
          guru: user?.nama || user?.email || '-',
          periode: `${selectedBulan.map((bulan) => monthLabelByValue(bulan)).join(', ')} - ${reportPeriodLabel}`,
          tahunAjaran,
          bobot: bobotMapel,
          sisaBobot,
          targetType: mapelRapotTargetType,
          totals: {
            siswa: students.length,
            tugas: tugasRows?.length || 0,
            quizReguler: (quizRows || []).filter((quiz) => normalizeQuizMode(quiz) === 'regular').length,
            quizUts: (quizRows || []).filter((quiz) => normalizeQuizMode(quiz) === 'uts').length,
            quizUas: (quizRows || []).filter((quiz) => normalizeQuizMode(quiz) === 'uas').length
          }
        })
      })
    } catch (error) {
      if (!isCurrentReportLoad(requestId)) return
      console.error(error)
      pushToast('error', error?.message || 'Gagal memuat laporan mapel')
      setMapelReportData(null)
    } finally {
      finishReportLoad(requestId, 'mapel')
    }
  }, [
    buildTeacherSummaryParams,
    finishReportLoad,
    isCurrentReportLoad,
    kelasList,
    mapelWeightByMapelKey,
    mapelRapotTargetType,
    monthLabelByValue,
    isActiveReportPeriod,
    pushToast,
    reportPeriod.semester,
    reportPeriod.tahunAjaran,
    reportPeriodLabel,
    selectedBulan,
    selectedKelas,
    selectedMapel,
    selectedSemester,
    selectedTahunAjaran,
    startReportLoad,
    user?.email,
    user?.id,
    user?.nama
  ])

  const handleSaveMapelManual = useCallback(async (row) => {
    if (!user?.id || !row?.id || !mapelReportData) return
    const draft = mapelManualDrafts[row.id] || {}
    const preview = getMapelManualPreview(row)
    const nilaiUtsManual = toNumberOrNull(draft.nilai_uts_manual)
    const nilaiUasManual = toNumberOrNull(draft.nilai_uas_manual)
    const nilaiManual = Number(mapelReportData.sisaBobot || 0) > 0
      ? toNumberOrNull(draft.nilai_manual)
      : null
    if (preview.invalid) {
      pushToast('error', 'Semua nilai manual harus berupa angka 0 sampai 100.')
      return
    }
    const existingId = row.manualRow?.id
    const nowIso = new Date().toISOString()
    const payload = {
      id: existingId || makeLocalId(),
      guru_id: user.id,
      siswa_id: row.id,
      kelas_id: selectedKelas,
      mapel: selectedMapel,
      tahun_ajaran: selectedTahunAjaran || reportPeriod.tahunAjaran,
      semester: selectedSemester || reportPeriod.semester,
      nilai_manual: nilaiManual,
      nilai_uts_manual: nilaiUtsManual,
      nilai_uas_manual: nilaiUasManual,
      catatan: String(draft.catatan || '').trim() || null,
      created_at: row.manualRow?.created_at || nowIso,
      updated_at: nowIso
    }

    try {
      setSavingMapelManualId(row.id)
      if (!isActiveReportPeriod || isFutureReportPeriod) {
        throw new Error('Periode arsip atau periode depan tidak dapat diubah tanpa konteks mutasi resmi.')
      }
      await gradeService.saveManualScore(payload)
      pushToast('success', `Nilai manual ${row.nama} berhasil disimpan.`)
      await loadLaporanMapel()
    } catch (error) {
      console.error(error)
      pushToast('error', error?.message || 'Gagal menyimpan nilai manual.')
    } finally {
      setSavingMapelManualId('')
    }
  }, [
    loadLaporanMapel,
    getMapelManualPreview,
    mapelManualDrafts,
    mapelReportData,
    pushToast,
    reportPeriod.semester,
    reportPeriod.tahunAjaran,
    isActiveReportPeriod,
    isFutureReportPeriod,
    selectedKelas,
    selectedMapel,
    selectedSemester,
    selectedTahunAjaran,
    user?.id
  ])

  const handleSendMapelToWali = useCallback(async (targetRows = null) => {
    if (!user?.id || !mapelReportData?.rows?.length || !selectedKelas || !selectedMapel) return

    const sourceRows = Array.isArray(targetRows) && targetRows.length ? targetRows : mapelReportData.rows
    const rowsToSend = sourceRows
      .map((row) => ({ row, preview: getMapelManualPreview(row) }))
      .filter(({ preview }) => preview.nilaiAkhir != null && !preview.invalid)

    if (!rowsToSend.length) {
      pushToast('error', 'Belum ada nilai akhir yang bisa dikirim ke wali kelas.')
      return
    }

    const lockedRows = sourceRows.filter((row) => row.rapotLocked)
    if (lockedRows.length) {
      pushToast('error', 'Rapot dikunci wali kelas. Harap hubungi wali kelas untuk membuka kunci.')
      return
    }

    const tahunAjaran = mapelReportData.tahunAjaran || selectedTahunAjaran || reportPeriod.tahunAjaran
    const semesterLabel = selectedSemester || reportPeriod.semester || 'Genap'

    try {
      setSendingMapelToWali(true)
      let sentCount = 0
      for (const { row, preview } of rowsToSend) {
        await reportCardService.upsertItem(row.id, {
          kelas_id: selectedKelas,
          jenis: mapelRapotTargetType,
          mapel: selectedMapel,
          kkm: toNumberOrNull(row.kkm) ?? KKM_NILAI_TUGAS,
          nilai: preview.nilaiAkhir,
          predikat: getGrade(preview.nilaiAkhir),
          keterangan: row.catatan || null,
          semester: semesterLabel,
          tahun_ajaran: tahunAjaran
        })
        sentCount += 1
      }

      const targetLabel = mapelRapotTargetType === 'uas'
        ? assessmentLabels.final.short
        : assessmentLabels.midterm.short
      pushToast('success', `${sentCount} nilai ${selectedMapel} dikirim ke Rapot ${targetLabel}.`)
      await loadLaporanMapel()
    } catch (error) {
      console.error(error)
      pushToast('error', error?.message || 'Gagal mengirim nilai ke wali kelas.')
    } finally {
      setSendingMapelToWali(false)
    }
  }, [
    assessmentLabels.final.short,
    assessmentLabels.midterm.short,
    getMapelManualPreview,
    loadLaporanMapel,
    mapelRapotTargetType,
    mapelReportData,
    pushToast,
    reportPeriod.semester,
    reportPeriod.tahunAjaran,
    selectedKelas,
    selectedMapel,
    selectedSemester,
    selectedTahunAjaran,
    user?.id
  ])

  const exportMapelReportToExcel = useCallback(async () => {
    if (!mapelReportData?.rows?.length) {
      pushToast('error', 'Muat Laporan Mapel terlebih dahulu.')
      return
    }
    const ok = await loadExcelLibrary()
    if (!ok || !ExcelJS) {
      pushToast('error', 'Library Excel belum siap.')
      return
    }

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Laporan Mapel')
    const borderAll = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }

    ws.addRow([`LAPORAN MAPEL - ${mapelReportData.mapel}`])
    ws.mergeCells(1, 1, 1, 9)
    ws.getCell('A1').font = { bold: true, size: 14 }
    ws.getCell('A1').alignment = { horizontal: 'center' }
    ws.addRow([`Kelas: ${mapelReportData.kelas}`])
    ws.addRow([`Guru: ${mapelReportData.guru}`])
    ws.addRow([`Periode: ${mapelReportData.periode}`])
    ws.addRow([])

    const b = mapelReportData.bobot || {}
    const header = ws.addRow([
      'No',
      'Nama',
      'NIS',
      `Tugas/PR (${Number(b.bobot_tugas_pr || 0)}%)`,
      `Quiz Reguler (${Number(b.bobot_quiz_reguler || 0)}%)`,
      `${b.sumber_uts === MAPEL_ASSESSMENT_SOURCE_MANUAL ? 'Kertas' : 'Quiz'} ${assessmentLabels.midterm.short} (${Number(b.bobot_quiz_uts || 0)}%)`,
      `${b.sumber_uas === MAPEL_ASSESSMENT_SOURCE_MANUAL ? 'Kertas' : 'Quiz'} ${assessmentLabels.final.short} (${Number(b.bobot_quiz_uas || 0)}%)`,
      `${getMapelManualComponentLabel(b)} (${Number(mapelReportData.sisaBobot || 0)}%)`,
      'Nilai Akhir'
    ])
    header.font = { bold: true }
    header.eachCell((cell) => {
      cell.border = borderAll
      cell.alignment = { horizontal: 'center' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
    })

    mapelReportData.rows.forEach((row, index) => {
      const preview = getMapelManualPreview(row)
      const excelRow = ws.addRow([
        index + 1,
        row.nama,
        row.nis || '-',
        row.tugasPr || '',
        row.quizReguler || '',
        preview.midtermScore || '',
        preview.finalScore || '',
        preview.manualScore || '',
        preview.nilaiAkhir || ''
      ])
      excelRow.eachCell((cell, col) => {
        cell.border = borderAll
        cell.alignment = { horizontal: col === 2 ? 'left' : 'center' }
      })
    })
    autoFitWorksheetColumns(ws, { min: 12, max: 42 })
    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `Laporan_Mapel_${mapelReportData.mapel}_${mapelReportData.kelas}.xlsx`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [assessmentLabels.final.short, assessmentLabels.midterm.short, getMapelManualPreview, mapelReportData, pushToast])

  const loadRekapWali = useCallback(async () => {
    if (!selectedWaliKelas || selectedBulan.length === 0) {
      startReportLoad()
      setRekapWaliData(null)
      return
    }

    const requestId = startReportLoad('rekap')
    try {
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

      const aggregate = await reportService.dashboardAggregate({
        kelas: selectedWaliKelas,
        bulan: selectedBulan.join(','),
        tahun,
        tahun_ajaran: selectedTahunAjaran || reportPeriod.tahunAjaran,
        semester: selectedSemester || reportPeriod.semester
      })

      let siswaData = sortStudentsByAttendanceOrder(aggregate.siswaData || [])
      const jadwalKelasList = filterSchedulesForSemester(aggregate.jadwalKelasList || [], selectedSemester)
      const tugasList = aggregate.tugasList || []
      const quizList = aggregate.quizList || []
      const absensiList = aggregate.absensiList || []
      const jawabanList = aggregate.jawabanList || []
      const submissionList = aggregate.submissionList || []
      const guruMapelWeightRows = aggregate.guruMapelWeightRows || []
      let guruMapelManualRows = aggregate.guruMapelManualRows || []
      let ekskulAnggotaList = aggregate.ekskulAnggotaList || []
      let ekskulList = aggregate.ekskulList || []
      let absensiEskulList = aggregate.absensiEskulList || []
      const ekskulIds = (ekskulList || []).map((item) => String(item?.id || '')).filter(Boolean)

      const jawabByKey = new Map()
        ; (jawabanList || []).forEach((j) => {
          jawabByKey.set(`${j.user_id}|${j.tugas_id}`, j)
        })

      const subByKey = new Map()
        ; (submissionList || []).forEach((s) => {
          subByKey.set(`${s.siswa_id}|${s.quiz_id}`, s)
        })

      const manualMapelByStudentKey = new Map()
      ;(guruMapelManualRows || []).forEach((row) => {
        const key = `${String(row?.siswa_id || '')}|${normalizeMapelKey(row?.mapel)}`
        if (!manualMapelByStudentKey.has(key)) manualMapelByStudentKey.set(key, row)
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

      const rekapEskulSiswa = sortStudentsByAttendanceOrder((siswaData || []).map((s) => {
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
      }))

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
          const manualMapel = manualMapelByStudentKey.get(`${String(s.id)}|${mapelInfo?.key || normalizeMapelKey(mapelInfo?.mapel)}`)
          const nilaiTengahTerpilih = bobotKomponenMapel.sumber_uts === MAPEL_ASSESSMENT_SOURCE_MANUAL
            ? toNumberOrNull(manualMapel?.nilai_uts_manual)
            : rataQuizUtsMapel
          const nilaiAkhirTerpilih = bobotKomponenMapel.sumber_uas === MAPEL_ASSESSMENT_SOURCE_MANUAL
            ? toNumberOrNull(manualMapel?.nilai_uas_manual)
            : rataQuizUasMapel
          const nilaiAkhirMapel = hitungNilaiMapelBerbobot({
            rataTugasMapel,
            rataQuizRegulerMapel,
            rataQuizUtsMapel,
            rataQuizUasMapel,
            nilaiUtsManual: manualMapel?.nilai_uts_manual,
            nilaiUasManual: manualMapel?.nilai_uas_manual,
            nilaiKomponenManual: manualMapel?.nilai_manual,
            bobotMapel: bobotKomponenMapel
          })

          return {
            mapel: mapelInfo?.mapel || 'Tanpa Mapel',
            mapelKey: mapelInfo?.key || normalizeMapelKey(mapelInfo?.mapel || 'Tanpa Mapel'),
            bobotKomponen: bobotKomponenMapel,
            rataTugas: rataTugasMapel,
            rataQuiz: rataQuizMapel,
            rataQuizReguler: rataQuizRegulerMapel,
            rataQuizUts: nilaiTengahTerpilih,
            rataQuizUas: nilaiAkhirTerpilih,
            nilaiManual: toNumberOrNull(manualMapel?.nilai_manual),
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

      startTransition(() => {
        if (!isCurrentReportLoad(requestId)) return
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
      })
    } catch (e) {
      if (!isCurrentReportLoad(requestId)) return
      console.error(e)
      pushToast('error', 'Gagal memuat rekap wali kelas')
    } finally {
      finishReportLoad(requestId, 'rekap')
    }
  }, [
    finishReportLoad,
    isCurrentReportLoad,
    monthLabelByValue,
    pushToast,
    reportPeriod.semester,
    reportPeriod.tahunAjaran,
    reportPeriodLabel,
    selectedBulan,
    selectedSemester,
    selectedTahunAjaran,
    selectedWaliKelas,
    startReportLoad,
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

        const aggregate = await reportService.dashboardAggregate({
          kelas: selectedWaliKelas,
          bulan: selectedBulan.join(','),
          tahun,
          tahun_ajaran: selectedTahunAjaran || reportPeriod.tahunAjaran,
          semester: selectedSemester || reportPeriod.semester
        })

        const jadwalList = filterSchedulesForSemester(aggregate.jadwalKelasList || [], selectedSemester)
        const tugasList = aggregate.tugasList || []
        const quizList = aggregate.quizList || []
        const guruMapelWeightRows = aggregate.guruMapelWeightRows || []

        let jawabanList = (aggregate.jawabanList || []).filter(j => String(j.user_id) === String(siswa.id))
        let submissionList = (aggregate.submissionList || []).filter(s => String(s.siswa_id) === String(siswa.id))

        let manualMapelRows = (aggregate.guruMapelManualRows || []).filter(r => String(r.siswa_id) === String(siswa.id))

        const manualMapelByKey = new Map()
        ;(manualMapelRows || []).forEach((row) => {
          const key = normalizeMapelKey(row?.mapel)
          if (key && !manualMapelByKey.has(key)) manualMapelByKey.set(key, row)
        })

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
            const manualMapel = manualMapelByKey.get(row.mapelKey)
            const nilaiTengahTerpilih = row.bobotKomponen.sumber_uts === MAPEL_ASSESSMENT_SOURCE_MANUAL
              ? toNumberOrNull(manualMapel?.nilai_uts_manual)
              : rataQuizUtsMapel
            const nilaiAkhirTerpilih = row.bobotKomponen.sumber_uas === MAPEL_ASSESSMENT_SOURCE_MANUAL
              ? toNumberOrNull(manualMapel?.nilai_uas_manual)
              : rataQuizUasMapel
            const rataAkademik = hitungNilaiMapelBerbobot({
              rataTugasMapel,
              rataQuizRegulerMapel,
              rataQuizUtsMapel,
              rataQuizUasMapel,
              nilaiUtsManual: manualMapel?.nilai_uts_manual,
              nilaiUasManual: manualMapel?.nilai_uas_manual,
              nilaiKomponenManual: manualMapel?.nilai_manual,
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
              rataQuizUts: nilaiTengahTerpilih ?? '-',
              rataQuizUas: nilaiAkhirTerpilih ?? '-',
              nilaiManual: toNumberOrNull(manualMapel?.nilai_manual) ?? '-',
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
      monthLabelByValue,
      pushToast,
      reportPeriod.semester,
      reportPeriod.tahunAjaran,
      reportPeriodLabel,
      selectedBulan,
      selectedSemester,
      selectedTahunAjaran,
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
    else if (activeTab === 'mapel') loadLaporanMapel()
  }, [
    activeTab,
    isRekapTab,
    loadRekapAbsensi,
    loadLaporanMapel,
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
    const absenOrderedRows = sortStudentsByAttendanceOrder(rekapWaliData?.siswa || [])
    if (!absenOrderedRows.length) return []
    const q = searchRekapEskul.trim().toLowerCase()
    if (!q) return absenOrderedRows

    return absenOrderedRows.filter((s) => {
      const nama = String(s.nama || '').toLowerCase()
      const nis = String(s.nis || '').toLowerCase()
      const daftarEskul = String((s.eskul?.eskulList || []).join(', ')).toLowerCase()
      return nama.includes(q) || nis.includes(q) || daftarEskul.includes(q)
    })
  }, [rekapWaliData?.siswa, searchRekapEskul])

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


      const payload = {
        user_id: siswaId,
        tugas_id: tugasId,
        nilai: nilaiFinal
      }
      await submissionService.gradeByUser(payload)

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


      const payload = {
        siswa_id: siswaId,
        quiz_id: quizId,
        score: scoreFinal,
        tahun_ajaran: reportPeriod.tahunAjaran,
        semester: reportPeriod.semester
      }
      await quizService.gradeByUser(payload)

      // Optimistic Update
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
      pushToast('error', `Gagal menyimpan: ${e?.message || 'Terjadi kesalahan'}`)
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
          .map((t) => s.nilaiTugas[t.id]?.nilai || '')
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
      const rows = sortStudentsByAttendanceOrder(rekapWaliData.siswa || [])
      rows.forEach((s, i) => {
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

    const rows = sortStudentsByAttendanceOrder(rekapWaliData.siswa || [])
    rows.forEach((s, i) => {
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
          <div className="page-title-layout">
            <div className="page-title-main">
              <div className="page-title-icon bg-blue-100 text-blue-700">
                <span>📊</span>
              </div>
              <div>
                <h1 className="page-title-heading">Laporan Guru</h1>
                <p className="page-title-description">Rekap absensi, tugas, quiz, dan laporan wali kelas dalam satu panel.</p>
              </div>
            </div>
            <div className="page-title-actions">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs text-slate-500">Akun Aktif</div>
              <div className="font-semibold text-slate-800">{user?.email || '-'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* === CONTROLS === */}
        <div
          className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/60 sismu-filter-grid print:hidden"
        >
          {/* Kelas */}
          <div className="sismu-filter-field">
            <label className="sismu-filter-label">
              Kelas
            </label>
            <select
              className="sismu-filter-control"
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
            <div className="sismu-filter-field">
              <label className="sismu-filter-label">
                Mapel
              </label>
              <select
                className="sismu-filter-control disabled:bg-gray-100 disabled:text-gray-400"
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

          {/* Multi-Select Bulan */}
          <div className="sismu-filter-field relative" ref={dropdownRef}>
            <label className="sismu-filter-label">
              Bulan & Tahun
            </label>
            <div>
              <button
                type="button"
                className="sismu-filter-control text-left flex justify-between items-center min-w-0"
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
            <div className="sismu-filter-help truncate">
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
          <div className="sismu-filter-field">
            <label className="sismu-filter-label">
              Aksi
            </label>
            <button
              className="sismu-filter-action bg-blue-600 text-white hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={Boolean(reportLoadingKey)}
              onClick={() => {
                if (activeTab === 'absensi') loadRekapAbsensi()
                else if (activeTab === 'tugas') loadRekapTugas()
                else if (activeTab === 'quiz') loadRekapQuiz()
                else if (activeTab === 'mapel') loadLaporanMapel()
                else if (isRekapTab) loadRekapWali()
              }}
            >
              <span>🔄</span> {reportLoadingKey ? 'Memuat...' : 'Muat Ulang'}
            </button>
            {reportLoadingLabel && (
              <div className="mt-2 text-xs font-medium text-blue-700">
                {reportLoadingLabel}
              </div>
            )}
          </div>

          {!isRekapTab && (
            <div className="sismu-filter-field">
              <label className="sismu-filter-label">
                Bobot Nilai
              </label>
              <button
                type="button"
                onClick={() => setShowMapelWeightOverlay(true)}
                className="sismu-filter-action border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition flex items-center justify-center gap-2 shadow-sm"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filter Bobot Nilai
              </button>
              <div className="sismu-filter-help truncate">
                {mapelWeightPeriodLabel}
              </div>
            </div>
          )}
        </div>

        {showMapelWeightOverlay && !isRekapTab && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm print:hidden">
            <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-indigo-600">Bobot Nilai</p>
                  <h3 className="mt-2 text-2xl font-black text-slate-950">Bobot Penilaian Per Mapel</h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
                      {mapelWeightPeriodLabel}
                    </span>
                    <span
                      className={`rounded-full border px-3 py-1 ${
                        mapelWeightPeriodTone === 'future'
                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                          : mapelWeightPeriodTone === 'archive'
                            ? 'border-sky-200 bg-sky-50 text-sky-700'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {mapelWeightPeriodTone === 'future'
                        ? 'Periode depan'
                        : mapelWeightPeriodTone === 'archive'
                          ? 'Periode arsip'
                          : 'Periode aktif'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMapelWeightOverlay(false)}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-slate-200 text-slate-500 hover:bg-slate-50"
                  aria-label="Tutup bobot nilai"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="overflow-y-auto p-6">
                {mapelWeightSetupMessage && (
                  <div className="mb-5 flex min-h-[112px] items-center justify-center rounded-2xl border border-dashed border-amber-200 bg-amber-50 px-6 py-5 text-center">
                    <div>
                      <p className="text-base font-black text-amber-800">{mapelWeightSetupMessage}</p>
                      <p className="mt-1 text-sm font-semibold text-amber-700">
                        Bobot yang terlihat saat ini adalah default periode ini sampai disimpan.
                      </p>
                    </div>
                  </div>
                )}

                {!mapelAmpuOptions.length ? (
                  <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-8 text-center">
                    <div>
                      <p className="text-lg font-black text-slate-900">Belum ada mapel pada periode ini</p>
                      <p className="mt-2 max-w-md text-sm text-slate-500">
                        Mapel akan muncul setelah jadwal, tugas, quiz, atau bobot periode ini tersedia.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(220px,0.9fr)_minmax(0,1.6fr)]">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Mapel Pengampu</label>
                        <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white">
                          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                            {mapelAmpuOptions.map((item) => {
                              const isSaved = mapelWeightedKeySet.has(normalizeMapelKey(item))
                              return (
                                <button
                                  key={item}
                                  type="button"
                                  onClick={() => setSelectedWeightMapel(item)}
                                  className={`w-full px-3 py-3 text-left flex items-center justify-between gap-2 ${
                                    selectedWeightMapel === item ? 'bg-indigo-50' : 'hover:bg-slate-50'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={isSaved}
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
                                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${
                                      isSaved
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                        : 'border-slate-200 bg-slate-50 text-slate-500'
                                    }`}
                                  >
                                    {isSaved ? 'Tersimpan' : 'Belum diset'}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          {MAPEL_COMPONENT_WEIGHT_RULES.map((rule) => (
                            <div key={rule.key}>
                              <label className="block text-xs font-semibold text-slate-600 mb-1">
                                {rule.key === 'bobot_quiz_uts'
                                  ? `Quiz ${assessmentLabels.midterm.formal}`
                                  : rule.key === 'bobot_quiz_uas'
                                    ? `Quiz ${assessmentLabels.final.formal}`
                                    : rule.label}
                              </label>
                              <input
                                type="number"
                                min={rule.min}
                                max={rule.max}
                                step="0.01"
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={mapelWeightForm[rule.key] || ''}
                                onChange={(e) => setMapelWeightForm((prev) => ({ ...prev, [rule.key]: e.target.value }))}
                              />
                            </div>
                          ))}
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-200 pt-4 lg:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-slate-600">
                              Sumber nilai {assessmentLabels.midterm.formal}
                            </label>
                            <select
                              value={mapelWeightForm.sumber_uts || 'digital'}
                              onChange={(event) => setMapelWeightForm((prev) => ({ ...prev, sumber_uts: event.target.value }))}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="digital">Quiz digital SISMU</option>
                              <option value="manual">Ujian kertas, input nilai manual</option>
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-slate-600">
                              Sumber nilai {assessmentLabels.final.formal}
                            </label>
                            <select
                              value={mapelWeightForm.sumber_uas || 'digital'}
                              onChange={(event) => setMapelWeightForm((prev) => ({ ...prev, sumber_uas: event.target.value }))}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="digital">Quiz digital SISMU</option>
                              <option value="manual">Ujian kertas, input nilai manual</option>
                            </select>
                          </div>
                        </div>

                        {mapelWeightValidation.remaining > 0 && (
                          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs font-semibold text-slate-600">
                                Penggunaan bobot manual {mapelWeightValidation.remaining}%
                              </label>
                              <select
                                value={mapelWeightForm.jenis_manual || MAPEL_MANUAL_COMPONENT_ATTENDANCE}
                                onChange={(event) => setMapelWeightForm((prev) => ({ ...prev, jenis_manual: event.target.value }))}
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value={MAPEL_MANUAL_COMPONENT_ATTENDANCE}>Absensi, input nilai manual</option>
                                <option value={MAPEL_MANUAL_COMPONENT_BONUS}>Nilai tambah Guru</option>
                                <option value={MAPEL_MANUAL_COMPONENT_OTHER}>Komponen lain</option>
                              </select>
                            </div>
                            {mapelWeightForm.jenis_manual === MAPEL_MANUAL_COMPONENT_OTHER && (
                              <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-600">Nama komponen manual</label>
                                <input
                                  type="text"
                                  maxLength={120}
                                  value={mapelWeightForm.label_manual || ''}
                                  onChange={(event) => setMapelWeightForm((prev) => ({ ...prev, label_manual: event.target.value }))}
                                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  placeholder="Contoh: Praktik laboratorium"
                                />
                              </div>
                            )}
                          </div>
                        )}

                        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                          <span
                            className={`rounded-full border px-2.5 py-1 ${
                              mapelWeightValidation.isValid
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-red-200 bg-red-50 text-red-700'
                            }`}
                          >
                            Total bobot: {mapelWeightValidation.total}%
                            {mapelWeightValidation.remaining > 0 ? ` - Sisa manual: ${mapelWeightValidation.remaining}%` : ''}
                          </span>
                          {selectedMapelWeightRow?.updated_at && (
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">
                              Tersimpan: {new Date(selectedMapelWeightRow.updated_at).toLocaleString('id-ID')}
                            </span>
                          )}
                          {!mapelWeightValidation.isValid && (
                            <span className="font-semibold text-red-600">{mapelWeightValidation.errors[0]}</span>
                          )}
                        </div>

                        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-600">
                          <p>Nilai tengah dan akhir semester dapat berasal dari Quiz digital atau ujian kertas yang nilainya dimasukkan Guru.</p>
                          <p>Jika total bobot belum 100%, sisanya dipakai untuk {getMapelManualComponentLabel(mapelWeightForm)}.</p>
                          <p>Setiap nilai manual wajib 0-100 dan sistem menampilkan kontribusi poin sesuai bobotnya.</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                      <p className="text-xs font-semibold text-slate-500">
                        Periode lalu membaca bobot tersimpan pada periode itu. Periode depan dimulai default sampai guru menyimpan bobot baru.
                      </p>
                      <button
                        type="button"
                        disabled={savingMapelWeight || !mapelWeightValidation.isValid}
                        onClick={handleSaveMapelWeight}
                        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingMapelWeight ? 'Menyimpan...' : 'Simpan Bobot Mapel'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
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
          <button
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${activeTab === 'mapel'
              ? 'bg-white shadow text-blue-700'
              : 'text-gray-600 hover:bg-slate-300'
              }`}
            onClick={() => setActiveTab('mapel')}
          >
            Laporan Mapel
          </button>
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
        {!mapelReportData && activeTab === 'mapel' && (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300">
            <p className="text-gray-500">
              Laporan mapel akan tampil otomatis setelah Kelas, Mapel, dan Bulan tersedia.
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

        {activeTab === 'mapel' && mapelReportData && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 print:bg-white flex flex-wrap gap-3 justify-between items-start">
              <div>
                <h3 className="font-bold text-gray-800">
                  Laporan Mapel - {mapelReportData.kelas} / {mapelReportData.mapel}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Guru: {mapelReportData.guru} • {mapelReportData.periode}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <select
                  value={mapelRapotTargetType}
                  onChange={(event) => setMapelRapotTargetType(event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                >
                  <option value="uts">Kirim ke Rapot {assessmentLabels.midterm.formal}</option>
                  <option value="uas">Kirim ke Rapot {assessmentLabels.final.formal}</option>
                </select>
                <button
                  type="button"
                  onClick={handleSendMapelToWali}
                  disabled={sendingMapelToWali}
                  className="text-xs bg-indigo-600 text-white px-3 py-2 rounded hover:bg-indigo-700 disabled:opacity-60"
                >
                  {sendingMapelToWali
                    ? 'Mengirim...'
                    : mapelReportData.rows?.some((row) => row.sentToWali)
                      ? 'Kirim Ulang Semua'
                      : 'Kirim Semua'}
                </button>
                <button
                  type="button"
                  onClick={exportMapelReportToExcel}
                  className="text-xs bg-emerald-600 text-white px-3 py-2 rounded hover:bg-emerald-700"
                >
                  Download Excel
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-7 gap-3 p-4 border-b border-slate-100">
              {[
                ['Siswa', mapelReportData.totals.siswa],
                [`Tugas/PR (${mapelReportData.bobot.bobot_tugas_pr}%)`, mapelReportData.totals.tugas],
                [`Quiz Reguler (${mapelReportData.bobot.bobot_quiz_reguler}%)`, mapelReportData.totals.quizReguler],
                [`${mapelReportData.bobot.sumber_uts === MAPEL_ASSESSMENT_SOURCE_MANUAL ? 'Kertas' : 'Quiz'} ${assessmentLabels.midterm.short} (${mapelReportData.bobot.bobot_quiz_uts}%)`, mapelReportData.bobot.sumber_uts === MAPEL_ASSESSMENT_SOURCE_MANUAL ? 'Input manual' : mapelReportData.totals.quizUts],
                [`${mapelReportData.bobot.sumber_uas === MAPEL_ASSESSMENT_SOURCE_MANUAL ? 'Kertas' : 'Quiz'} ${assessmentLabels.final.short} (${mapelReportData.bobot.bobot_quiz_uas}%)`, mapelReportData.bobot.sumber_uas === MAPEL_ASSESSMENT_SOURCE_MANUAL ? 'Input manual' : mapelReportData.totals.quizUas],
                [`${getMapelManualComponentLabel(mapelReportData.bobot)} (${mapelReportData.sisaBobot}%)`, mapelReportData.sisaBobot > 0 ? 'Input manual' : 'Tidak dipakai'],
                [`Terkirim ke Rapot ${mapelReportData.targetType === 'uas' ? assessmentLabels.final.short : assessmentLabels.midterm.short}`, mapelReportData.rows.filter((row) => row.sentToWali).length]
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold text-slate-500">{label}</div>
                  <div className="text-lg font-bold text-slate-900">{value}</div>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left">Siswa</th>
                    <th className="px-4 py-3 text-center">NIS</th>
                    <th className="px-4 py-3 text-center">Tugas/PR ({mapelReportData.bobot.bobot_tugas_pr}%)</th>
                    <th className="px-4 py-3 text-center">Quiz Reguler ({mapelReportData.bobot.bobot_quiz_reguler}%)</th>
                    <th className="px-4 py-3 text-center min-w-[150px]">
                      {mapelReportData.bobot.sumber_uts === MAPEL_ASSESSMENT_SOURCE_MANUAL ? 'Kertas' : 'Quiz'} {assessmentLabels.midterm.short} ({mapelReportData.bobot.bobot_quiz_uts}%)
                    </th>
                    <th className="px-4 py-3 text-center min-w-[150px]">
                      {mapelReportData.bobot.sumber_uas === MAPEL_ASSESSMENT_SOURCE_MANUAL ? 'Kertas' : 'Quiz'} {assessmentLabels.final.short} ({mapelReportData.bobot.bobot_quiz_uas}%)
                    </th>
                    <th className="px-4 py-3 text-center min-w-[180px]">{getMapelManualComponentLabel(mapelReportData.bobot)} ({mapelReportData.sisaBobot}%)</th>
                    <th className="px-4 py-3 text-center">Nilai Akhir</th>
                    <th className="px-4 py-3 text-center print:hidden">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mapelReportData.rows.map((row) => {
                    const draft = mapelManualDrafts[row.id] || {}
                    const manualPreview = getMapelManualPreview(row)
                    const usesManualMidterm = mapelReportData.bobot.sumber_uts === MAPEL_ASSESSMENT_SOURCE_MANUAL
                    const usesManualFinal = mapelReportData.bobot.sumber_uas === MAPEL_ASSESSMENT_SOURCE_MANUAL
                    const manualDisabled = Number(mapelReportData.sisaBobot || 0) <= 0 || !isActiveReportPeriod
                    const midtermManualDisabled = Number(mapelReportData.bobot.bobot_quiz_uts || 0) <= 0 || !isActiveReportPeriod
                    const finalManualDisabled = Number(mapelReportData.bobot.bobot_quiz_uas || 0) <= 0 || !isActiveReportPeriod
                    const hasEditableManualComponent = !manualDisabled
                      || (usesManualMidterm && !midtermManualDisabled)
                      || (usesManualFinal && !finalManualDisabled)
                    return (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-900">{row.nama}</td>
                        <td className="px-4 py-3 text-center text-slate-600">{row.nis || '-'}</td>
                        {[row.tugasPr, row.quizReguler].map((value, index) => (
                          <td key={index} className="px-4 py-3 text-center">
                            <span className={`inline-flex min-w-[54px] justify-center rounded-lg border px-2 py-1 text-xs font-bold ${getNilaiToneClass(value)}`}>
                              {value ?? '-'}
                            </span>
                          </td>
                        ))}
                        <td className="px-4 py-3 text-center">
                          {usesManualMidterm ? (
                            <div className="flex flex-col gap-1.5">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                disabled={midtermManualDisabled}
                                value={draft.nilai_uts_manual || ''}
                                onChange={(event) => setMapelManualDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: { ...(prev[row.id] || {}), nilai_uts_manual: event.target.value }
                                }))}
                                className={`w-full rounded-lg border px-3 py-2 text-sm disabled:bg-slate-100 ${
                                  manualPreview.invalidMidterm ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-300'
                                }`}
                                placeholder="0-100"
                              />
                              <span className="text-[11px] text-slate-500">
                                {manualPreview.midtermScore != null && !manualPreview.invalidMidterm
                                  ? `+${round2(manualPreview.midtermWeighted)} poin`
                                  : 'Nilai ujian kertas'}
                              </span>
                            </div>
                          ) : (
                            <span className={`inline-flex min-w-[54px] justify-center rounded-lg border px-2 py-1 text-xs font-bold ${getNilaiToneClass(row.quizUts)}`}>
                              {row.quizUts ?? '-'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {usesManualFinal ? (
                            <div className="flex flex-col gap-1.5">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                disabled={finalManualDisabled}
                                value={draft.nilai_uas_manual || ''}
                                onChange={(event) => setMapelManualDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: { ...(prev[row.id] || {}), nilai_uas_manual: event.target.value }
                                }))}
                                className={`w-full rounded-lg border px-3 py-2 text-sm disabled:bg-slate-100 ${
                                  manualPreview.invalidFinal ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-300'
                                }`}
                                placeholder="0-100"
                              />
                              <span className="text-[11px] text-slate-500">
                                {manualPreview.finalScore != null && !manualPreview.invalidFinal
                                  ? `+${round2(manualPreview.finalWeighted)} poin`
                                  : 'Nilai ujian kertas'}
                              </span>
                            </div>
                          ) : (
                            <span className={`inline-flex min-w-[54px] justify-center rounded-lg border px-2 py-1 text-xs font-bold ${getNilaiToneClass(row.quizUas)}`}>
                              {row.quizUas ?? '-'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-2">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              disabled={manualDisabled}
                              value={draft.nilai_manual || ''}
                              onChange={(e) => setMapelManualDrafts((prev) => ({
                                ...prev,
                                [row.id]: { ...(prev[row.id] || {}), nilai_manual: e.target.value }
                              }))}
                              className={`w-full rounded-lg border px-3 py-2 text-sm disabled:bg-slate-100 ${
                                manualPreview.invalidManual ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-300'
                              }`}
                              placeholder={manualDisabled ? 'Bobot penuh' : '0-100'}
                            />
                            <input
                              type="text"
                              disabled={!isActiveReportPeriod}
                              value={draft.catatan || ''}
                              onChange={(e) => setMapelManualDrafts((prev) => ({
                                ...prev,
                                [row.id]: { ...(prev[row.id] || {}), catatan: e.target.value }
                              }))}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:bg-slate-100"
                              placeholder="Catatan opsional"
                            />
                            {manualDisabled ? (
                              <span className="text-[11px] text-slate-500">Total bobot sudah 100%, nilai manual tidak dipakai.</span>
                            ) : (
                              <span className="text-[11px] text-slate-500">
                                Bobot {getMapelManualComponentLabel(mapelReportData.bobot)} {mapelReportData.sisaBobot}% {manualPreview.manualScore != null && !manualPreview.invalidManual
                                  ? `= +${round2(manualPreview.manualWeighted)} poin`
                                  : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex min-w-[64px] justify-center rounded-lg border px-2 py-1 text-sm font-bold ${getNilaiToneClass(manualPreview.nilaiAkhir)}`}>
                            {manualPreview.nilaiAkhir ?? '-'}
                          </span>
                          {row.sentToWali && (
                            <div className="mt-1 text-[11px] font-semibold text-emerald-700">
                              Terkirim
                            </div>
                          )}
                          {row.rapotLocked && (
                            <div className="mt-1 text-[11px] font-semibold text-red-600">
                              Dikunci wali
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center print:hidden">
                          <div className="flex flex-col items-center gap-2">
                            <button
                              type="button"
                              disabled={savingMapelManualId === row.id || !hasEditableManualComponent || manualPreview.invalid}
                              onClick={() => handleSaveMapelManual(row)}
                              className="w-full min-w-[92px] rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {savingMapelManualId === row.id ? 'Simpan...' : 'Simpan'}
                            </button>
                            <button
                              type="button"
                              disabled={!isActiveReportPeriod || sendingMapelToWali || manualPreview.nilaiAkhir == null || manualPreview.invalid || row.rapotLocked}
                              onClick={() => handleSendMapelToWali([row])}
                              className="w-full min-w-[92px] rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                            >
                              {row.sentToWali ? `Kirim Ulang ${mapelRapotTargetLabel}` : `Kirim ${mapelRapotTargetLabel}`}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
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
                                defaultValue={nilaiSiswa || ''}
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
                      const specialLabel = getQuizSpecialLabel(q, selectedSemester || reportPeriod.semester)
                      const isSpecialQuiz = Boolean(specialLabel)
                      return (
                        <th
                          key={q.id}
                          className={`px-2 py-3 text-center min-w-[72px] ${
                            isSpecialQuiz
                              ? 'bg-orange-100 text-orange-800'
                              : ''
                          }`}
                          title={q.nama || getQuizColumnLabel(q, i, selectedSemester || reportPeriod.semester)}
                        >
                          <span className="block">{getQuizColumnLabel(q, i, selectedSemester || reportPeriod.semester)}</span>
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
                        const isSpecialQuiz = Boolean(getQuizSpecialLabel(q, selectedSemester || reportPeriod.semester))
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
                                defaultValue={nilaiSiswa || ''}
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
