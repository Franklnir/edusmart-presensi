import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAcademicContext } from '../context/AcademicContext'
import { normalizeAcademicYear, normalizeSemester, resolveAcademicPeriod } from '../utils/academicPeriod'

const DEFAULT_FILTER_STORAGE_KEY = 'edusmart.default.periodFilter'
const SEMESTER_OPTIONS = [
  { value: 'Ganjil', label: 'Semester Ganjil' },
  { value: 'Genap', label: 'Semester Genap' }
]

const toPeriodFilter = (period) => ({
  tahunAjaran: period?.tahunAjaran || '',
  semester: period?.semester || 'Ganjil'
})

const normalizeStoredPeriodFilter = (value, fallback) => {
  if (!value || typeof value !== 'object') return fallback
  const tahunAjaran = normalizeAcademicYear(value.tahunAjaran || value.tahun_ajaran)
  const semester = normalizeSemester(value.semester || value.semester_aktif)
  if (!tahunAjaran) return fallback

  return { tahunAjaran, semester: semester || fallback.semester }
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

const writeStoredPeriodFilter = (storageKey, periodFilter, activeAcademicPeriod, compareSemester = true) => {
  if (!storageKey || typeof window === 'undefined') return
  try {
    const followsActive =
      periodFilter?.tahunAjaran === activeAcademicPeriod?.tahunAjaran &&
      (!compareSemester || periodFilter?.semester === activeAcademicPeriod?.semester)
    if (followsActive) window.localStorage.removeItem(storageKey)
    else window.localStorage.setItem(storageKey, JSON.stringify(periodFilter))
  } catch (error) {
    // The in-memory filter remains usable when browser storage is unavailable.
  }
}

export default function useActiveAcademicPeriod({
  storageKey = DEFAULT_FILTER_STORAGE_KEY,
  persistFilter = true,
  scope = 'term'
} = {}) {
  const { activeAcademicPeriod, academicYearOptions, tenantId } = useAcademicContext()
  const isTermScoped = scope !== 'year'
  const scopedStorageKey = storageKey
    ? `${storageKey}:${tenantId || 'anonymous'}`
    : ''
  const [periodFilter, setPeriodFilter] = useState(() => {
    const fallback = toPeriodFilter(activeAcademicPeriod)
    return persistFilter ? readStoredPeriodFilter(scopedStorageKey, fallback) : fallback
  })
  const previousActivePeriodRef = useRef(activeAcademicPeriod)

  useEffect(() => {
    const fallback = toPeriodFilter(activeAcademicPeriod)
    setPeriodFilter(persistFilter ? readStoredPeriodFilter(scopedStorageKey, fallback) : fallback)
  }, [scopedStorageKey, persistFilter])

  useEffect(() => {
    setPeriodFilter((previous) => {
      const year = normalizeAcademicYear(previous?.tahunAjaran)
      const semester = normalizeSemester(previous?.semester)
      const previousActive = previousActivePeriodRef.current
      const followedPreviousActive =
        year === previousActive?.tahunAjaran &&
        (!isTermScoped || semester === previousActive?.semester)

      if (!year || !semester || followedPreviousActive) {
        return toPeriodFilter(activeAcademicPeriod)
      }

      return previous
    })
    previousActivePeriodRef.current = activeAcademicPeriod
  }, [activeAcademicPeriod, isTermScoped])

  useEffect(() => {
    if (persistFilter) {
      writeStoredPeriodFilter(scopedStorageKey, periodFilter, activeAcademicPeriod, isTermScoped)
    }
  }, [activeAcademicPeriod, isTermScoped, periodFilter, persistFilter, scopedStorageKey])

  const semesterScopedPeriod = useMemo(() => resolveAcademicPeriod({
    tahun_ajaran: periodFilter.tahunAjaran || activeAcademicPeriod.tahunAjaran,
    semester_aktif: periodFilter.semester || activeAcademicPeriod.semester,
    periode_mulai: activeAcademicPeriod.periodeMulai,
    periode_selesai: activeAcademicPeriod.periodeSelesai,
    periode_ganjil_mulai: activeAcademicPeriod.periodeGanjilMulai,
    periode_ganjil_selesai: activeAcademicPeriod.periodeGanjilSelesai,
    periode_genap_mulai: activeAcademicPeriod.periodeGenapMulai,
    periode_genap_selesai: activeAcademicPeriod.periodeGenapSelesai
  }), [activeAcademicPeriod, periodFilter])

  const yearScopedPeriod = useMemo(() => {
    const months = semesterScopedPeriod.academicYearMonths?.length
      ? semesterScopedPeriod.academicYearMonths
      : semesterScopedPeriod.months
    const firstMonth = months[0] || null
    const lastMonth = months[months.length - 1] || null

    return {
      ...semesterScopedPeriod,
      semester: '',
      months,
      monthNumbers: months.map((item) => item.month),
      monthLabels: months.map((item) => item.label),
      startsAt: firstMonth?.startDate || semesterScopedPeriod.startsAt,
      endsAt: lastMonth?.endDate || semesterScopedPeriod.endsAt,
      rangeLabel:
        semesterScopedPeriod.academicYearRangeLabel ||
        (firstMonth && lastMonth
          ? `${firstMonth.label} - ${lastMonth.label}`
          : semesterScopedPeriod.rangeLabel),
      scope: 'academic_year'
    }
  }, [semesterScopedPeriod])

  const setAcademicYear = useCallback((tahunAjaran) => {
    const normalized = normalizeAcademicYear(tahunAjaran)
    if (normalized) setPeriodFilter((previous) => ({ ...previous, tahunAjaran: normalized }))
  }, [])

  const setSemester = useCallback((semester) => {
    const normalized = normalizeSemester(semester)
    if (normalized) setPeriodFilter((previous) => ({ ...previous, semester: normalized }))
  }, [])

  const resetToActivePeriod = useCallback(() => {
    setPeriodFilter(toPeriodFilter(activeAcademicPeriod))
  }, [activeAcademicPeriod])

  const applyAcademicYearFilter = useCallback((query) => {
    if (!yearScopedPeriod.tahunAjaran) return query
    return query.eq('tahun_ajaran', yearScopedPeriod.tahunAjaran)
  }, [yearScopedPeriod.tahunAjaran])

  const applyAcademicSemesterFilter = useCallback((query) => {
    let next = query
    if (semesterScopedPeriod.tahunAjaran) next = next.eq('tahun_ajaran', semesterScopedPeriod.tahunAjaran)
    if (semesterScopedPeriod.semester) next = next.eq('semester', semesterScopedPeriod.semester)
    return next
  }, [semesterScopedPeriod.semester, semesterScopedPeriod.tahunAjaran])

  const isViewingArchivePeriod =
    semesterScopedPeriod.tahunAjaran !== activeAcademicPeriod.tahunAjaran ||
    (isTermScoped && semesterScopedPeriod.semester !== activeAcademicPeriod.semester)

  return {
    tenantId,
    scope: isTermScoped ? 'academic_term' : 'academic_year',
    mode: isViewingArchivePeriod ? 'archive' : 'active',
    academicYearCacheKey: [tenantId || 'tenant', yearScopedPeriod.tahunAjaran || 'year', 'academic_year'].join(':'),
    academicSemesterCacheKey: [
      tenantId || 'tenant',
      semesterScopedPeriod.tahunAjaran || 'year',
      semesterScopedPeriod.semester || 'semester',
      isViewingArchivePeriod ? 'archive' : 'active'
    ].join(':'),
    activeAcademicPeriod,
    periodFilter,
    period: yearScopedPeriod,
    termPeriod: semesterScopedPeriod,
    dateFilterPeriod: semesterScopedPeriod,
    activeSemesterPeriod: semesterScopedPeriod,
    isViewingArchivePeriod,
    isMutationLocked: isViewingArchivePeriod,
    academicYearOptions,
    semesterOptions: SEMESTER_OPTIONS,
    setAcademicYear,
    setSemester,
    setPeriodFilter,
    resetToActivePeriod,
    applyAcademicYearFilter,
    applyAcademicSemesterFilter,
    activeAcademicPeriodPayload: {
      tahun_ajaran: activeAcademicPeriod.tahunAjaran,
      semester: activeAcademicPeriod.semester
    },
    selectedAcademicPeriodPayload: {
      tahun_ajaran: semesterScopedPeriod.tahunAjaran,
      semester: semesterScopedPeriod.semester
    },
    academicPeriodPayload: {
      tahun_ajaran: semesterScopedPeriod.tahunAjaran,
      semester: semesterScopedPeriod.semester
    }
  }
}
