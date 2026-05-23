import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  getAcademicYearOptions,
  normalizePeriodFilter,
  resolveAcademicPeriod
} from '../utils/attendanceDate'

const STORAGE_KEY = 'edusmart.attendance.periodFilter'

const withCalendarSemester = (period) => {
  const current = resolveAcademicPeriod()
  if (period?.tahunAjaran !== current.tahunAjaran) return period
  return { ...period, semester: current.semester }
}

const readStoredPeriodFilter = (fallback) => {
  if (typeof window === 'undefined') return fallback

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const normalized = normalizePeriodFilter(JSON.parse(raw))
    return { ...normalized, semester: '' }
  } catch (error) {
    return fallback
  }
}

const writeStoredPeriodFilter = (periodFilter, activeAcademicPeriod) => {
  if (typeof window === 'undefined') return

  try {
    const followsActive =
      periodFilter?.tahunAjaran === activeAcademicPeriod?.tahunAjaran

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
  const initialAcademicPeriod = withCalendarSemester(resolveAcademicPeriod())
  const [activeAcademicPeriod, setActiveAcademicPeriod] = useState(initialAcademicPeriod)
  const initialFilter = {
    tahunAjaran: initialAcademicPeriod.tahunAjaran,
    semester: ''
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

        const resolved = withCalendarSemester(resolveAcademicPeriod(data || {}))
        setActiveAcademicPeriod(resolved)
        setPeriodFilter((prev) => {
          const normalized = normalizePeriodFilter(prev)
          const stillInitial =
            normalized.tahunAjaran === initialAcademicPeriod.tahunAjaran
          if (!stillInitial) return { ...normalized, semester: '' }

          return {
            tahunAjaran: resolved.tahunAjaran,
            semester: ''
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
    semester: activeAcademicPeriod.semester
  }), [activeAcademicPeriod.semester, periodFilter.tahunAjaran])

  const setAcademicYear = (tahunAjaran) => {
    const normalized = normalizePeriodFilter({ tahunAjaran, semester: '' })
    setPeriodFilter((prev) => ({ ...prev, tahunAjaran: normalized.tahunAjaran, semester: '' }))
  }

  const setSemester = () => {}

  const resetToActivePeriod = () => {
    setPeriodFilter({
      tahunAjaran: activeAcademicPeriod.tahunAjaran,
      semester: ''
    })
  }

  return {
    academicPeriodPayload,
    activeAcademicPeriod,
    academicYearOptions: getAcademicYearOptions(activeAcademicPeriod),
    isViewingArchivePeriod:
      periodFilter.tahunAjaran !== activeAcademicPeriod.tahunAjaran,
    periodFilter,
    resetToActivePeriod,
    semesterOptions: [],
    setAcademicYear,
    setPeriodFilter,
    setSemester,
  }
}
