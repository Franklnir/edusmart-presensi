import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  SEMESTER_GANJIL,
  SEMESTER_GENAP,
  generateAcademicYearOptions,
  normalizeAcademicYear,
  normalizeSemester,
  resolveAcademicPeriod
} from '../utils/academicPeriod'

const toPeriodFilter = (period) => ({
  tahunAjaran: period.tahunAjaran,
  semester: period.semester
})

const DEFAULT_FILTER_STORAGE_KEY = 'edusmart.default.periodFilter'

const normalizeStoredPeriodFilter = (value, fallback) => {
  if (!value || typeof value !== 'object') return fallback
  const tahunAjaran = normalizeAcademicYear(value.tahunAjaran || value.tahun_ajaran)
  const semester = normalizeSemester(value.semester)
  if (!tahunAjaran || !semester) return fallback

  return { tahunAjaran, semester }
}

const readStoredPeriodFilter = (storageKey, fallback) => {
  if (!storageKey || typeof window === 'undefined') return fallback

  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? normalizeStoredPeriodFilter(JSON.parse(raw), fallback) : fallback
  } catch (error) {
    return fallback
  }
}

const writeStoredPeriodFilter = (storageKey, periodFilter, activeAcademicPeriod) => {
  if (!storageKey || typeof window === 'undefined') return

  try {
    const followsActive =
      periodFilter?.tahunAjaran === activeAcademicPeriod?.tahunAjaran &&
      periodFilter?.semester === activeAcademicPeriod?.semester

    if (followsActive) {
      window.localStorage.removeItem(storageKey)
    } else {
      window.localStorage.setItem(storageKey, JSON.stringify(periodFilter))
    }
  } catch (error) {
    // Ignore storage errors so the filter still works in memory.
  }
}

export default function useActiveAcademicPeriod({
  storageKey = DEFAULT_FILTER_STORAGE_KEY,
  persistFilter = true
} = {}) {
  const fallback = useMemo(() => resolveAcademicPeriod(), [])
  const [activeAcademicPeriod, setActiveAcademicPeriod] = useState(fallback)
  const [periodFilter, setPeriodFilter] = useState(() => (
    persistFilter
      ? readStoredPeriodFilter(storageKey, toPeriodFilter(fallback))
      : toPeriodFilter(fallback)
  ))
  const activeAcademicPeriodRef = useRef(fallback)

  useEffect(() => {
    activeAcademicPeriodRef.current = activeAcademicPeriod
  }, [activeAcademicPeriod])

  useEffect(() => {
    if (!persistFilter) return
    writeStoredPeriodFilter(storageKey, periodFilter, activeAcademicPeriod)
  }, [activeAcademicPeriod, periodFilter, persistFilter, storageKey])

  useEffect(() => {
    let cancelled = false

    const applyResolvedPeriod = (resolved) => {
      setActiveAcademicPeriod(resolved)
      setPeriodFilter((prev) => {
        const year = normalizeAcademicYear(prev.tahunAjaran)
        const semester = normalizeSemester(prev.semester)
        const isFallbackPeriod = year === fallback.tahunAjaran && semester === fallback.semester
        const currentActive = activeAcademicPeriodRef.current
        const isPreviousActive =
          year === currentActive.tahunAjaran && semester === currentActive.semester
        if (year && semester && !isFallbackPeriod && !isPreviousActive) return prev
        return toPeriodFilter(resolved)
      })
    }

    const load = async () => {
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('tahun_ajaran, semester_aktif, periode_mulai, periode_selesai, periode_ganjil_mulai, periode_ganjil_selesai, periode_genap_mulai, periode_genap_selesai')
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (error) throw error
        if (cancelled) return

        const resolved = resolveAcademicPeriod(data || {})
        applyResolvedPeriod(resolved)
      } catch (error) {
        if (!cancelled) {
          setActiveAcademicPeriod(fallback)
          setPeriodFilter((prev) => {
            const year = normalizeAcademicYear(prev.tahunAjaran)
            const semester = normalizeSemester(prev.semester)
            return year && semester ? prev : toPeriodFilter(fallback)
          })
        }
      }
    }

    load()
    const channel = supabase
      .channel('active_academic_period_settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, (payload) => {
        if (cancelled) return
        const resolved = resolveAcademicPeriod(payload.new || {})
        applyResolvedPeriod(resolved)
      })
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [fallback])

  const resolvedPeriod = useMemo(
    () => resolveAcademicPeriod({
      tahun_ajaran: periodFilter.tahunAjaran || activeAcademicPeriod.tahunAjaran,
      semester_aktif: periodFilter.semester || activeAcademicPeriod.semester,
      periode_mulai: activeAcademicPeriod.periodeMulai,
      periode_selesai: activeAcademicPeriod.periodeSelesai,
      periode_ganjil_mulai: activeAcademicPeriod.periodeGanjilMulai,
      periode_ganjil_selesai: activeAcademicPeriod.periodeGanjilSelesai,
      periode_genap_mulai: activeAcademicPeriod.periodeGenapMulai,
      periode_genap_selesai: activeAcademicPeriod.periodeGenapSelesai
    }),
    [
      activeAcademicPeriod.semester,
      activeAcademicPeriod.periodeMulai,
      activeAcademicPeriod.periodeSelesai,
      activeAcademicPeriod.periodeGanjilMulai,
      activeAcademicPeriod.periodeGanjilSelesai,
      activeAcademicPeriod.periodeGenapMulai,
      activeAcademicPeriod.periodeGenapSelesai,
      activeAcademicPeriod.tahunAjaran,
      periodFilter.semester,
      periodFilter.tahunAjaran
    ]
  )

  const yearScopedPeriod = useMemo(() => {
    const months = resolvedPeriod.academicYearMonths?.length
      ? resolvedPeriod.academicYearMonths
      : resolvedPeriod.months
    const firstMonth = months[0] || null
    const lastMonth = months[months.length - 1] || null

    return {
      ...resolvedPeriod,
      months,
      monthNumbers: months.map((item) => item.month),
      monthLabels: months.map((item) => item.label),
      startsAt: firstMonth?.startDate || resolvedPeriod.startsAt,
      endsAt: lastMonth?.endDate || resolvedPeriod.endsAt,
      rangeLabel:
        resolvedPeriod.academicYearRangeLabel ||
        (firstMonth && lastMonth ? `${firstMonth.label} - ${lastMonth.label}` : resolvedPeriod.rangeLabel),
      scope: 'academic_year'
    }
  }, [resolvedPeriod])

  const academicYearOptions = useMemo(
    () => generateAcademicYearOptions({ back: 5, forward: 2 }),
    []
  )

  const setAcademicYear = useCallback((tahunAjaran) => {
    const normalized = normalizeAcademicYear(tahunAjaran)
    if (!normalized) return
    setPeriodFilter((prev) => ({ ...prev, tahunAjaran: normalized }))
  }, [])

  const setSemester = useCallback((semester) => {
    const normalized = normalizeSemester(semester)
    if (!normalized) return
    setPeriodFilter((prev) => ({ ...prev, semester: normalized }))
  }, [])

  const resetToActivePeriod = useCallback(() => {
    setPeriodFilter(toPeriodFilter(activeAcademicPeriod))
  }, [activeAcademicPeriod])

  const applyPeriodFilters = useCallback(
    (query) => {
      let next = query
      if (yearScopedPeriod.tahunAjaran) next = next.eq('tahun_ajaran', yearScopedPeriod.tahunAjaran)
      return next
    },
    [yearScopedPeriod.tahunAjaran]
  )

  const applySemesterPeriodFilters = useCallback(
    (query) => {
      let next = query
      if (resolvedPeriod.tahunAjaran) next = next.eq('tahun_ajaran', resolvedPeriod.tahunAjaran)
      if (resolvedPeriod.semester) next = next.eq('semester', resolvedPeriod.semester)
      return next
    },
    [resolvedPeriod.semester, resolvedPeriod.tahunAjaran]
  )

  return {
    activeAcademicPeriod,
    periodFilter,
    period: yearScopedPeriod,
    activeSemesterPeriod: resolvedPeriod,
    isViewingArchivePeriod:
      resolvedPeriod.tahunAjaran !== activeAcademicPeriod.tahunAjaran ||
      resolvedPeriod.semester !== activeAcademicPeriod.semester,
    academicYearOptions,
    semesterOptions: [SEMESTER_GANJIL, SEMESTER_GENAP],
    setAcademicYear,
    setSemester,
    setPeriodFilter,
    resetToActivePeriod,
    applyPeriodFilters,
    applySemesterPeriodFilters,
    activeAcademicPeriodPayload: {
      tahun_ajaran: activeAcademicPeriod.tahunAjaran,
      semester: activeAcademicPeriod.semester
    },
    selectedAcademicPeriodPayload: {
      tahun_ajaran: resolvedPeriod.tahunAjaran,
      semester: resolvedPeriod.semester
    },
    academicPeriodPayload: {
      tahun_ajaran: resolvedPeriod.tahunAjaran,
      semester: resolvedPeriod.semester
    }
  }
}
