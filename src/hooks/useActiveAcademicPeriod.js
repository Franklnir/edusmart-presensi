import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { queryClient, queryKeys } from '../lib/queryClient'
import { useAuthStore } from '../store/useAuthStore'
import {
  generateAcademicYearOptions,
  getCurrentAcademicPeriod,
  normalizeAcademicYear,
  resolveAcademicPeriod
} from '../utils/academicPeriod'

const toPeriodFilter = (period) => ({
  tahunAjaran: period.tahunAjaran,
  semester: ''
})

const DEFAULT_FILTER_STORAGE_KEY = 'edusmart.default.periodFilter'
const SETTINGS_PERIOD_COLUMNS = 'id, tahun_ajaran, semester_aktif, periode_mulai, periode_selesai, periode_ganjil_mulai, periode_ganjil_selesai, periode_genap_mulai, periode_genap_selesai, max_ekskul_per_siswa, updated_at'

const withCalendarSemester = (period) => {
  const current = getCurrentAcademicPeriod()
  if (period?.tahunAjaran !== current.tahunAjaran) return period

  return {
    ...period,
    semester: current.semester,
    label: `${period.tahunAjaran} - Semester ${current.semester}`
  }
}

const normalizeStoredPeriodFilter = (value, fallback) => {
  if (!value || typeof value !== 'object') return fallback
  const tahunAjaran = normalizeAcademicYear(value.tahunAjaran || value.tahun_ajaran)
  if (!tahunAjaran) return fallback

  return { tahunAjaran, semester: '' }
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
      periodFilter?.tahunAjaran === activeAcademicPeriod?.tahunAjaran

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
  const authSettings = useAuthStore((state) => state.settings)
  const fallback = useMemo(
    () => withCalendarSemester(resolveAcademicPeriod(useAuthStore.getState().settings || {})),
    []
  )
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

  const applyResolvedPeriod = useCallback((resolved) => {
    setActiveAcademicPeriod(resolved)
    setPeriodFilter((prev) => {
      const year = normalizeAcademicYear(prev.tahunAjaran)
      const isFallbackPeriod = year === fallback.tahunAjaran
      const currentActive = activeAcademicPeriodRef.current
      const isPreviousActive = year === currentActive.tahunAjaran
      if (year && !isFallbackPeriod && !isPreviousActive) return { ...prev, semester: '' }
      return toPeriodFilter(resolved)
    })
  }, [fallback.tahunAjaran])

  useEffect(() => {
    if (!authSettings) return
    const resolved = withCalendarSemester(resolveAcademicPeriod(authSettings || {}))
    applyResolvedPeriod(resolved)
  }, [applyResolvedPeriod, authSettings])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const data = await queryClient.fetchQuery({
          queryKey: queryKeys.admin.activeAcademicPeriodSettings(),
          queryFn: async () => {
            const { data, error } = await supabase
              .from('settings')
              .select(SETTINGS_PERIOD_COLUMNS)
              .order('id', { ascending: true })
              .limit(1)
              .maybeSingle()

            if (error) throw error
            return data || {}
          },
          staleTime: 60 * 1000
        })
        if (cancelled) return

        const resolved = withCalendarSemester(resolveAcademicPeriod(data || {}))
        applyResolvedPeriod(resolved)
      } catch (error) {
        if (!cancelled) {
          setActiveAcademicPeriod(fallback)
          setPeriodFilter((prev) => {
            const year = normalizeAcademicYear(prev.tahunAjaran)
            return year ? { ...prev, semester: '' } : toPeriodFilter(fallback)
          })
        }
      }
    }

    load()
    const channel = supabase
      .channel('active_academic_period_settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, (payload) => {
        if (cancelled) return
        queryClient.setQueryData(queryKeys.admin.activeAcademicPeriodSettings(), payload.new || {})
        const resolved = withCalendarSemester(resolveAcademicPeriod(payload.new || {}))
        applyResolvedPeriod(resolved)
      })
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [applyResolvedPeriod, fallback])

  const resolvedPeriod = useMemo(
    () => resolveAcademicPeriod({
      tahun_ajaran: periodFilter.tahunAjaran || activeAcademicPeriod.tahunAjaran,
      semester_aktif: activeAcademicPeriod.semester,
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
      semester: '',
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
    setPeriodFilter((prev) => ({ ...prev, tahunAjaran: normalized, semester: '' }))
  }, [])

  const setSemester = useCallback(() => {}, [])

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
      if (yearScopedPeriod.tahunAjaran) next = next.eq('tahun_ajaran', yearScopedPeriod.tahunAjaran)
      return next
    },
    [yearScopedPeriod.tahunAjaran]
  )

  return {
    activeAcademicPeriod,
    periodFilter,
    period: yearScopedPeriod,
    dateFilterPeriod: yearScopedPeriod,
    activeSemesterPeriod: yearScopedPeriod,
    isViewingArchivePeriod:
      yearScopedPeriod.tahunAjaran !== activeAcademicPeriod.tahunAjaran,
    academicYearOptions,
    semesterOptions: [],
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
      tahun_ajaran: yearScopedPeriod.tahunAjaran,
      semester: ''
    },
    academicPeriodPayload: {
      tahun_ajaran: yearScopedPeriod.tahunAjaran,
      semester: activeAcademicPeriod.semester
    }
  }
}
