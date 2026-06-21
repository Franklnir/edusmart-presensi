import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const ACTIVE_HISTORY_STATUSES = ['active', 'nonaktif', 'mutasi']

const getFallbackClass = (profile) => (
  String(profile?.kelas || profile?.kelas_id || '').trim()
)

export async function fetchStudentPeriodClass({ userId, profile, tahunAjaran }) {
  const fallbackClass = getFallbackClass(profile)
  const studentId = String(userId || profile?.id || '').trim()
  const year = String(tahunAjaran || '').trim()

  if (!studentId || !year) return fallbackClass

  let { data, error } = await supabase
    .from('student_class_histories')
    .select('class_id')
    .eq('student_id', studentId)
    .eq('tahun_ajaran', year)
    .in('status', ACTIVE_HISTORY_STATUSES)
    .order('valid_from', { ascending: false })
    .limit(1)

  if (error && /status|valid_from/i.test(error.message || '')) {
    ;({ data, error } = await supabase
      .from('student_class_histories')
      .select('class_id')
      .eq('student_id', studentId)
      .eq('tahun_ajaran', year)
      .limit(1))
  }

  if (error) {
    console.warn('Gagal memuat kelas siswa sesuai periode:', error)
    return fallbackClass
  }

  return String(data?.[0]?.class_id || fallbackClass || '').trim()
}

export default function useStudentPeriodClass({ userId, profile, tahunAjaran }) {
  const fallbackClass = useMemo(() => getFallbackClass(profile), [profile])
  const [periodClass, setPeriodClass] = useState(fallbackClass)

  useEffect(() => {
    let cancelled = false

    const resolveClass = async () => {
      const studentId = String(userId || profile?.id || '').trim()
      const year = String(tahunAjaran || '').trim()

      if (!studentId || !year) {
        setPeriodClass(fallbackClass)
        return
      }

      try {
        const resolvedClass = await fetchStudentPeriodClass({ userId: studentId, profile, tahunAjaran: year })
        if (cancelled) return
        setPeriodClass(resolvedClass)
      } catch (error) {
        if (!cancelled) {
          console.warn('Gagal memuat kelas siswa sesuai periode:', error)
          setPeriodClass(fallbackClass)
        }
      }
    }

    resolveClass()

    return () => {
      cancelled = true
    }
  }, [fallbackClass, profile?.id, tahunAjaran, userId])

  return periodClass || fallbackClass
}
