import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  SEMESTER_OPTIONS,
  getAcademicYearOptions,
  normalizePeriodFilter,
  resolveAcademicPeriod
} from '../utils/attendanceDate'

const STORAGE_KEY = 'edusmart.academic.periodFilter'

const readStoredPeriodFilter = (fallback) => {
  if (typeof window === 'undefined') return fallback

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? normalizePeriodFilter(JSON.parse(raw)) : fallback
  } catch (error) {
    return fallback
  }
}

const writeStoredPeriodFilter = (periodFilter, activeAcademicPeriod) => {
  if (typeof window === 'undefined') return

  try {
    const followsActive =
      periodFilter?.tahunAjaran === activeAcademicPeriod?.tahunAjaran &&
      periodFilter?.semester === activeAcademicPeriod?.semester

    if (followsActive) {
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(periodFilter))
    }
  } catch (error) {
    // Ignore storage errors so the filter still works in memory.
  }
}

export function useAttendanceAcademicPeriod() {
  const initialAcademicPeriod = resolveAcademicPeriod()
  const [activeAcademicPeriod, setActiveAcademicPeriod] = useState(initialAcademicPeriod)
  const initialFilter = {
    tahunAjaran: initialAcademicPeriod.tahunAjaran,
    semester: initialAcademicPeriod.semester
  }
  const [periodFilter, setPeriodFilter] = useState(() => readStoredPeriodFilter(initialFilter))

  useEffect(() => {
    const loadAcademicPeriod = async () => {
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('tahun_ajaran,semester_aktif,periode_mulai,periode_selesai,periode_ganjil_mulai,periode_ganjil_selesai,periode_genap_mulai,periode_genap_selesai')
          .limit(1)
          .maybeSingle()

        if (error && error.code !== 'PGRST116') {
          console.warn('Gagal memuat periode akademik aktif:', error)
          return
        }

        const resolved = resolveAcademicPeriod(data || {})
        setActiveAcademicPeriod(resolved)
        setPeriodFilter((prev) => {
          const normalized = normalizePeriodFilter(prev)
          const stillInitial =
            normalized.tahunAjaran === initialAcademicPeriod.tahunAjaran &&
            normalized.semester === initialAcademicPeriod.semester
          if (!stillInitial) return normalized

          return {
            tahunAjaran: resolved.tahunAjaran,
            semester: resolved.semester
          }
        })
      } catch (error) {
        console.warn('Gagal memuat periode akademik aktif:', error)
      }
    }

    loadAcademicPeriod()
  }, [])

  useEffect(() => {
    writeStoredPeriodFilter(periodFilter, activeAcademicPeriod)
  }, [activeAcademicPeriod, periodFilter])

  const academicPeriodPayload = useMemo(() => ({
    tahun_ajaran: periodFilter.tahunAjaran,
    semester: periodFilter.semester
  }), [periodFilter.semester, periodFilter.tahunAjaran])

  const setAcademicYear = (tahunAjaran) => {
    setPeriodFilter((prev) => normalizePeriodFilter({ ...prev, tahunAjaran }))
  }

  const setSemester = (semester) => {
    setPeriodFilter((prev) => normalizePeriodFilter({ ...prev, semester }))
  }

  const resetToActivePeriod = () => {
    setPeriodFilter({
      tahunAjaran: activeAcademicPeriod.tahunAjaran,
      semester: activeAcademicPeriod.semester
    })
  }

  return {
    academicPeriodPayload,
    activeAcademicPeriod,
    academicYearOptions: getAcademicYearOptions(activeAcademicPeriod),
    isViewingArchivePeriod:
      periodFilter.tahunAjaran !== activeAcademicPeriod.tahunAjaran ||
      periodFilter.semester !== activeAcademicPeriod.semester,
    periodFilter,
    resetToActivePeriod,
    semesterOptions: SEMESTER_OPTIONS,
    setAcademicYear,
    setPeriodFilter,
    setSemester,
  }
}
