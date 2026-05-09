import { useCallback, useEffect, useMemo, useState } from 'react'
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

export default function useActiveAcademicPeriod() {
  const fallback = useMemo(() => resolveAcademicPeriod(), [])
  const [activeAcademicPeriod, setActiveAcademicPeriod] = useState(fallback)
  const [periodFilter, setPeriodFilter] = useState(() => toPeriodFilter(fallback))

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('tahun_ajaran, semester_aktif')
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (error) throw error
        if (cancelled) return

        const resolved = resolveAcademicPeriod(data || {})
        setActiveAcademicPeriod(resolved)
        setPeriodFilter((prev) => {
          const year = normalizeAcademicYear(prev.tahunAjaran)
          const semester = normalizeSemester(prev.semester)
          const isFallbackPeriod = year === fallback.tahunAjaran && semester === fallback.semester
          if (year && semester && !isFallbackPeriod) return prev
          return toPeriodFilter(resolved)
        })
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

    return () => {
      cancelled = true
    }
  }, [fallback])

  const resolvedPeriod = useMemo(
    () => resolveAcademicPeriod({
      tahun_ajaran: periodFilter.tahunAjaran || activeAcademicPeriod.tahunAjaran,
      semester_aktif: periodFilter.semester || activeAcademicPeriod.semester
    }),
    [
      activeAcademicPeriod.semester,
      activeAcademicPeriod.tahunAjaran,
      periodFilter.semester,
      periodFilter.tahunAjaran
    ]
  )

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
      if (resolvedPeriod.tahunAjaran) next = next.eq('tahun_ajaran', resolvedPeriod.tahunAjaran)
      if (resolvedPeriod.semester) next = next.eq('semester', resolvedPeriod.semester)
      return next
    },
    [resolvedPeriod.semester, resolvedPeriod.tahunAjaran]
  )

  return {
    activeAcademicPeriod,
    periodFilter,
    period: resolvedPeriod,
    academicYearOptions,
    semesterOptions: [SEMESTER_GANJIL, SEMESTER_GENAP],
    setAcademicYear,
    setSemester,
    setPeriodFilter,
    resetToActivePeriod,
    applyPeriodFilters,
    academicPeriodPayload: {
      tahun_ajaran: resolvedPeriod.tahunAjaran,
      semester: resolvedPeriod.semester
    }
  }
}
