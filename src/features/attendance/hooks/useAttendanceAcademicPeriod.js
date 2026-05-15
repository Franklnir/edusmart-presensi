import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { resolveAcademicPeriod } from '../utils/attendanceDate'

export function useAttendanceAcademicPeriod() {
  const initialAcademicPeriod = resolveAcademicPeriod()
  const [activeAcademicPeriod, setActiveAcademicPeriod] = useState(initialAcademicPeriod)
  const [periodFilter, setPeriodFilter] = useState(() => ({
    tahunAjaran: initialAcademicPeriod.tahunAjaran,
    semester: initialAcademicPeriod.semester
  }))

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
        setPeriodFilter({
          tahunAjaran: resolved.tahunAjaran,
          semester: resolved.semester
        })
      } catch (error) {
        console.warn('Gagal memuat periode akademik aktif:', error)
      }
    }

    loadAcademicPeriod()
  }, [])

  const academicPeriodPayload = useMemo(() => ({
    tahun_ajaran: periodFilter.tahunAjaran,
    semester: periodFilter.semester
  }), [periodFilter.semester, periodFilter.tahunAjaran])

  return {
    academicPeriodPayload,
    activeAcademicPeriod,
    periodFilter,
    setPeriodFilter,
  }
}
